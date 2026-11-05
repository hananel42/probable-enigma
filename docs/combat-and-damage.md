# Combat and Damage Contract

## Target acquisition

All automated attackers call `findPriorityHostileTarget` in `src/game/combat.ts`. The selectable tiers are described by `ENTITY_CATALOG` and `BUILDING_CATALOG`:

1. The nearest hostile commander or combat drone with a working weapon.
2. The nearest hostile weapon structure (`WEAPON` role).
3. The hostile Core / spawn objective.
4. Support infrastructure, including drone and harvester stations.
5. Ordinary structures and fortifications.
6. Harmless units, once all structure targets are unavailable.

A candidate outside the caller's sensor or weapon range is not considered. Distance decides only among candidates at the same tier. A building candidate must also be operational: its own Core must still be alive. An orphaned building becomes gray and inert; it is excluded from new target selection, cached drone targets, defense alerts, weapon target caches, and projectile collision, but it remains in the world for salvage. Auto-Turrets and Fire Towers run a true initial target scan, then revalidate the cached target between scheduled scans. Drones, auto-turrets, Fire Tower target focus, defensive commander fire, and active commander attack goals share this rule. Manual player fire intentionally follows the cursor.

## Defense alerts

A drone station in `DEFENSE` mode patrols the connected compound, but detection of a hostile in the 420-pixel sensor envelope moves the drone from patrol into combat. It approaches a safe stand-off position and does not advance its patrol angle while engaged. It sends a 4.5-second alert to allied units. A responding drone or idle enemy commander joins only if it has no valid local fight; its own local target remains higher priority. Expired or destroyed targets are discarded.

`ESCORT` drones keep their formation around their commander or the player while continuing to use the common weapon selector for enemies within weapon range.

## Health and death

`applyEntityDamage` and `applyBuildingDamage` reject non-finite or negative damage and invalid HP/armor state, and clamp legitimate lethal damage at zero. Their returned `DamageApplication` reports the actual amount removed so hit feedback cannot display more damage than the target had remaining. Lethal commander damage immediately sets `isDead`, freezes movement, clears burn and mining state, and starts the three-second respawn timer. Non-commander units are removed by the engine's cleanup pass. Buildings are removed by the building update pass; a destroyed player Core triggers game over.

Burning, projectiles, and Fire Tower pulses all use the same damage helpers. New damage sources must never perform `target.hp -= damage` directly.

## Failure visibility

Invalid simulation deltas and malformed damage inputs throw instead of becoming zero-damage/no-op updates. Callers must not add catch-and-continue behavior around combat updates; errors should reach the runtime error handler and console with their original stack.
