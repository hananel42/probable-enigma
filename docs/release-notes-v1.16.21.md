# v1.16.21 — PeerJS Cloud and direct WebRTC rooms

- Added `peerjs` as an application dependency and made PeerJS Cloud the default room discovery/signalling service.
- Added `PeerJsRoomClient`, which creates one host peer and up to seven direct guest data connections. Game commands, host-authored initial state, deltas, ACKs, and resynchronization use the reliable ordered WebRTC data channels rather than the PeerJS signalling server.
- Host peer IDs are a stable application prefix plus a cryptographically random five-letter suffix. Only the suffix is displayed/shared. Room ID conflicts are detected and retried, with a hard retry cap and actionable errors.
- Added peer metadata checks, connection-capacity checks, stable transport-assigned sender identities, message-size validation, channel-backlog checks, peer disconnect lifecycle messages, and console-visible errors.
- Made the self-hosted WebSocket relay developer-only in the lobby under **Developer Options**. There is no automatic fallback from failed direct WebRTC.
- Documented PeerJS Cloud's role and limits, including shared ID space and the fact that this build does not configure TURN. Added identity-generation tests.

## Validation

- `npm test` covers the simulation/integration suite plus the new fixed-prefix and five-letter room-code tests.
- Full `npm install`, `npm run lint`, and `npm run build` should be run in a network-enabled environment where the `peerjs` package can be installed.
- A real two-browser test across distinct networks is still required to verify PeerJS Cloud availability, ICE negotiation, NAT traversal, guest joining, state deltas, and disconnect cleanup end to end.
