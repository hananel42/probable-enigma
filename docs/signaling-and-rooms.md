# Multiplayer room discovery and direct links

The production application uses PeerJS Cloud for signalling and establishes direct reliable WebRTC data connections between the room host and guests. The unused local WebSocket relay and developer networking controls have been removed.

Room codes are five unambiguous letters. A direct invite link adds the code as a `room` query parameter (for example, `https://your-game.example/?room=ABCDE`). On opening a valid link, the lobby reads the code and automatically attempts to join. It rejects malformed or duplicate `room` parameters and removes the `room` parameter from the current URL when the player leaves.

The room link is a locator, not an authentication credential. The current game does not provide accounts, room passwords, persistence, host migration, or reconnection/resume. PeerJS Cloud provides signalling only; it does not relay gameplay traffic or guarantee a direct route through every NAT/firewall. The application configures STUN but does not include TURN credentials, so some networks will be unable to establish a WebRTC channel.

For implementation details, see [`peerjs-webrtc.md`](peerjs-webrtc.md), [`host-authoritative-multiplayer.md`](host-authoritative-multiplayer.md), and [`state-replication.md`](state-replication.md).
