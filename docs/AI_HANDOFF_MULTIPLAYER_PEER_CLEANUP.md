# מסמך מסירה ל-AI: תיקון ניתוקי אורחים, מעבר למשחק וניקוי PeerJS

## מה לבצע

יש לבצע תיקון קוד אמיתי בפרויקט הזה — לא להסתפק בניתוח או בתיעוד. קודם לקרוא את הקוד הקיים ואת הבדיקות, לאמת את מקור התקלה, לממש תיקון קטן וממוקד, להוסיף בדיקות רגרסיה, להריץ את מלוא הבדיקות וה-build, ולמסור ZIP חדש. אין להניח שהתיקונים המתוארים ב-release notes כבר עובדים בפועל: הלוגים מההרצה האחרונה מוכיחים שעדיין קיימת בעיית lifecycle.

## תסמינים מדווחים

1. אורח נשאר במסך ניהול החדר גם אחרי שהמארח מתחיל את המשחק.
2. המארח חוזר שוב ושוב על הודעות כגון:
   - `Target peer has no registered direct connection`
   - `State delta was not queued; the next attempt will include all changes since the last sent revision.`
3. בהמשך מופיע `Guest missed the bidirectional liveness deadline`.
4. הניסיון לסגור את החיבור מחזיר `Cannot close an unregistered guest connection`.
5. ניקוי המשתתף מסתיים ב-`AggregateError`, שדלף מתוך מחזור הפרסום והפעיל את טיפול השגיאות הגלובלי של האפליקציה.
6. רשימת החדר מציגה משתתפים שהתנתקו; צריך להציג רק משתתפים מחוברים. שחקן מובס צריך להישאר ברשימה כל עוד החיבור שלו פעיל, יחד עם מצב חי/מובס ומצב החיבור.

## מפת קוד להתחלה

- `src/game/multiplayer/HostRoomController.ts` — בעל הסמכות של החדר: `startMatch`, `flushStateUpdates`, `broadcastRoomStatus`, `sendRoomStatusToPeer`, `pruneMissingTransportPeers`, `removePeer`, `removePeerDuringPublication`.
- `src/game/multiplayer/PeerJsRoomClient.ts` — מתאם PeerJS: רישום `DataConnection`, `sendData`, `hasPeerConnection`, `closePeer`, אירועי `open`/`close`/`error` ותחזוקת מפות החיבורים.
- `src/game/multiplayer/WebRtcDataChannelTransport.ts` — מתאם נתונים נוסף; יש לוודא שהחוזה וניקוי ה-peer עקביים בין שני המתאמים.
- `src/game/multiplayer/transport.ts` — חוזה `GameDataTransport` והודעות הפרוטוקול.
- `src/game/multiplayer/RemoteGameClientPort.ts` — קבלת room status, סנכרון מצב העולם ומוכנות האורח.
- `src/game/multiplayer/roomManagement.ts` ו-`src/App.tsx` — מבנה הרשימה, מעבר `lobby → playing → results`, והצגת מסך ניהול החדר.
- `src/game/server/LocalGameServer.ts` — הסימולציה הסמכותית; אין לתת לכשל ניקוי של אורח יחיד לעצור את מנוע המשחק כולו.
- בדיקות קיימות: `src/game/multiplayer/hostRoomController.test.ts`, `RemoteGameClientPort.test.ts`, `WebRtcDataChannelTransport.test.ts`, `stateReplication.test.ts`, `twoPlayerIntegration.test.ts`.

## אבחנות לבדיקה ולאימות בקוד

### A. חוסר התאמה בין רישום החדר לרישום התחבורה

הלוג `Target peer has no registered direct connection` אומר שמנגנון החדר עדיין מנסה לפרסם ל-peer שכבר אינו קיים במתאם התחבורה. בדוק את המפות `playerByPeer`, `replicationByPeer`, `lastSequenceByPeer`, `roomStatusByPeer`, ואת מפות החיבורים/החיבורים הממתינים ב-`PeerJsRoomClient` וב-`WebRtcDataChannelTransport`.

יש ליצור מסלול reconciliation יחיד ועקבי: ברגע ש-peer אינו מחובר לפי הרישום הסמכותי של המתאם, לא שולחים אליו עוד delta או room status; מסירים באופן עקבי את כל הרשומות המשויכות אליו ואת המשתתף/נכסים הפעילים לפי כללי המשחק. יש להביא בחשבון שמיפוי המשתתף יכול להיעלם לפני מיפוי ה-replication ולהפך. מצב כזה צריך להיתקן כאירוע lifecycle כפול, לא להישאר כרשומת ghost ולא לגרום לחריגה שנייה.

אל תסמוך רק על `hasPeerConnection` אם הוא בודק רק `connection.open`, בזמן שרישום אחר עדיין מחזיק אובייקט סגור. בדוק את האינווריאנטים מול המתאם בפועל וכתוב בדיקות גם ל-peer שנעלם לפני אירוע `close`, וגם ל-peer שנסגר במתאם לפני שהמארח מבצע cleanup.

### B. ניקוי חייב להיות idempotent ולא להפיל את tick

`removePeer` נקרא ממספר מסלולים: אירוע close, timeout של heartbeat, reconciliation מחזורי, kick, וסגירת חדר. ייתכן ששני מסלולים יפעלו כמעט באותו זמן. הפוך את הניקוי לאידמפוטנטי בכל שילוב של המפות והחיבור.

- `closePeer` צריך להתייחס לחיבור שכבר הוסר כתוצאה ניקוי שהושלמה; מותר לרשום `info`/diagnostic, אבל לא להציג זאת ככשל חדש.
- אם קיימת רשומת replication בלי רשומת participant, עדיין צריך לפנות את רשומות ה-peer והחיבור, ולרשום במפורש את הפרת האינווריאנט.
- אם קיימת רשומת participant בלי חיבור, יש להסיר אותה ואת הנכסים הפעילים שלה, ולפרסם roster חדש.
- יש להמשיך לטפל בשאר המשתתפים גם אם שלב cleanup אחד נכשל. כל כשל צריך להיכתב לקונסול עם `peerId`, `playerId`, סיבת הניקוי ושלב הניקוי; אסור ליצור `catch {}` שקט או לבלוע חריגה בלי אבחון.
- מחזור `setInterval` לא יכול לקבל `AggregateError` בלתי מטופל שמפסיק את המשחק כולו. יש לדווח על הכשל ולהציג אבחון, אך להחזיק את tick והטיפול בשאר ה-peers. חריגות חמורות של invariant עדיין חייבות להיות גלויות ולא להיעלם.
- הימנע מלוגים זהים בכל 50ms עבור אותו peer חסר; שמור deduplication/rate-limit לאבחון החוזר, אך המשך לעדכן מוני retry ולשמור את פרטי הכשל.

### C. מעבר מארח/אורח מ-Lobby למשחק

בדוק את `HostRoomController.startMatch` יחד עם `broadcastRoomStatus` ו-`sendRoomStatusToPeer`. המצב החדש `playing` חייב להגיע לכל peer פעיל; כשל שליחה זמני אינו יכול להירשם כאילו ההודעה כבר נשלחה.

- שמור מצב room-status אחרון **לכל peer בנפרד** ועדכן אותו רק לאחר שהמתאם אישר שההודעה הוכנסה לשליחה.
- אם שליחת `game-room-status` נכשלה, השאר אותה pending לניסיון נוסף; שינוי `lobby → playing` לא יכול להיעלם בגלל עדכון cache מוקדם.
- בדוק את סדר הפעולות בזמן התחלת משחק: מעבר פאזה, הפעלת הסימולציה, פרסום מצב החדר, שליחת/אישור full-state ומעבר ה-UI. אם אורח כבר קיבל snapshot התחלתי ב-lobby, ודא שהתחלת המשחק יוצרת נתיב אמין שממשיך לספק עדכונים ומפעיל את UI המשחק.
- אין להשתמש ב-React render או ב-canvas frame כטריגר הבלעדי לשליחת מצב חדר או לסנכרון. רשת וחדר חייבים להמשיך לפי השעון שלהם.
- הוסף test אינטגרציה שמתחיל חדר, מצרף אורח, משאיר אותו ב-lobby, מתחיל משחק אצל המארח, ומוודא שהאורח מקבל `playing`, מצב עולם חדש/עדכונים, והממשק אינו נשאר במסך החדר.

### D. רשימת משתתפים פעילים בלבד

ב-`HostRoomController.buildRoomStatus`, roster צריך להיבנות רק מתוך `humanPlayers` עם `connected === true`. מסנן נוסף ב-UI יכול להגן מפני envelope ישן, אך הוא אינו תחליף לתיקון מקור הנתונים. שחקנים מובסים אבל עדיין מחוברים נשארים ברשימה עם `phase: defeated` ועם מצב חיבור מחובר. שחקנים מנותקים או kicked אינם מוצגים כמשתתפים פעילים.

וודא שהסרת peer מפרסמת roster מעודכן באופן מיידי ושמירת מצב room-status per peer לא מונעת משלוח העדכון הזה.

## גבולות ארכיטקטורה נדרשים

שמור על הפרדה בין:

1. **Game authority** — חוקים, עולם ופקודות משחק (`LocalGameServer` דרך חוזה צר כגון `RoomGameAuthority`).
2. **Room/session protocol** — הקצאת שחקן, פאזה, roster, heartbeat, ACKs, deltas וניקוי משתתף (`HostRoomController` / `RemoteGameClientPort`).
3. **Transport adapter** — פתיחה/סגירה, שליחה, backpressure ורישום peer פעיל (`PeerJsRoomClient`, `WebRtcDataChannelTransport`).
4. **UI** — תצוגת מצב שמתקבל מהפרוטוקול; אינה בעלת הסמכות לקבוע שמישהו מחובר או שהמשחק התחיל.

אין להוסיף fallback שקט. כל חריגה שנתפסת חייבת לכלול `console.error`/`console.warn` עם הקשר מלא, והחלטה ברורה האם לנסות שוב, להסיר peer פגום או להציג שגיאה. כשל של אורח אחד אינו אמור לעצור את כל הסימולציה או למנוע שליחה לאורחים אחרים.

## בדיקות קבלה שחייבות לעבור

1. אורח מצטרף; המארח מתחיל משחק; האורח עוזב את מסך החדר ורואה משחק פעיל תוך זמן סביר.
2. שינוי מצב room מ-`lobby` ל-`playing` נשלח שוב אם send נכשל זמנית.
3. ניתוק peer בין בדיקת `hasPeerConnection` לבין `sendData` אינו יוצר לולאת delta אינסופית או `AggregateError` לא מטופל.
4. cleanup שמופעל פעמיים (close + heartbeat timeout) מסיים עם כל המפות נקיות, בלי למחוק שחקן אחר ובלי להיכשל רק כי החיבור כבר נעדר.
5. peer חסר מסולק מיידית מהרשומות ומה-roster; שאר האורחים ממשיכים לקבל deltas.
6. roster מציג רק `connected === true`; שחקן מובס אבל מחובר נשאר עם מצב מובס.
7. כשל `closePeer` או `sendData` מתועד ומוצג לאבחון, אך אינו מפסיק את מנוע המשחק כולו.
8. בדיקות `npm test`, `npm run lint`, `npm run build`, ובדיקת שני דפדפנים אמיתיים (host + guest), כולל התחלה, סגירת טאב אורח וניתוק בזמן publication.

## פקודות לאימות

```powershell
npm install
npm test
npm run lint
npm run build
```

לא לסמן build או בדיקת דפדפן כעברו בלי להריץ אותם בפועל. בסוף למסור סיכום של root cause שאומת מול הקוד, קבצים ששונו, תוצאות הפקודות, ומגבלות שנותרו. אל תעדכן גרסה או תבצע refactor גדול שלא נדרש לתיקון הזה.
