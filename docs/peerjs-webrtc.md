# PeerJS Cloud and direct WebRTC rooms

## Default connection path

The lobby defaults to PeerJS Cloud for room discovery and signalling. The client explicitly uses the public PeerJS Cloud endpoint at `0.peerjs.com:443` over TLS. PeerJS Cloud brokers the connection; the game-data channel is a direct WebRTC `RTCDataChannel` between the host browser and each guest browser. Game commands, authoritative initial states, state deltas, acknowledgements and recovery states do not pass through the PeerJS signalling service when a direct connection succeeds.

The room creator is the sole simulation authority and acts as a star-topology WebRTC host. Up to seven guests connect directly to that browser. Each guest opens one reliable, ordered PeerJS data connection to the host. The current `GameDataTransport` contract uses PeerJS application protocol v2 and world-state sync protocol v3. A peer advertising an older application or state-sync version is rejected; there is no negotiation or compatibility adapter. Connections explicitly use PeerJS BinaryPack (`serialization: 'binary'`) so large full-state frames take the library's chunked binary-send path rather than the JSON serializer.

## Room ID format

`src/game/multiplayer/peerJsRoomIdentity.ts` defines the application-wide constant prefix:

`sderg44g4n5g45jg459gm495g495j49kt54ktk945jter_`

The host's PeerJS ID is that fixed prefix plus a random five-letter suffix. Only the five-letter suffix is shown in the UI and needs to be shared. Guests derive the same long host ID locally. Room suffixes use cryptographically secure random bytes, an unambiguous alphabet, and rejection sampling rather than `Math.random()`. If PeerJS Cloud reports that an ID is already in use, host creation tries a fresh suffix up to eight times and then reports the failure.

The prefix is an application namespace, not a secret or an authorization mechanism. PeerJS Cloud uses a shared namespace, so global ID collisions are possible and are handled explicitly. The five-letter code is a room locator, not a password; do not rely on it to protect sensitive data. The current game has no account authentication or room-password system.

## Transport reliability and validation

- The application protocol uses reliable, ordered PeerJS data connections because state deltas require an exact revision chain.
- Messages are checked by the shared `peerMessageEnvelope.ts` for a plain-object envelope, a bounded non-empty `type`, JSON compatibility, and a 16 MiB maximum UTF-8 JSON-envelope size before transport. The JSON encoding is used only for deterministic size validation; it is not the DataConnection wire serializer. BinaryPack is the actual wire format and handles large payloads through PeerJS chunking. Sender identity is assigned from `DataConnection.peer`; identity supplied inside a payload is overwritten.
- The host validates connection metadata against the application ID, protocol version, room code, and guest role before accepting a channel. The host permits at most seven guest connections.
- A direct connection close produces a transport-owned `game-peer-left` notification for the host controller, allowing it to remove the disconnected participant and their live-owned objects.
- The data transport observes the data channel's queued bytes where PeerJS exposes the channel. A congested peer is not fed further reliable messages; the host protocol's revision/ACK logic can request a full state if synchronization stops progressing. A failed full-state delivery remains a bounded, ACK-verified recovery attempt rather than an endless retry loop.
- Signalling loss is logged and the PeerJS connection is retried with bounded exponential backoff. Existing direct channels may continue during temporary signalling outages, but new peers cannot join until the signalling connection returns. Per-peer heartbeat/ACK traffic remains on the direct channel independently of the rendering loop; a guest that is still alive in the room continues to heartbeat after defeat.
- A `DataConnection` `error` event is not treated as proof that its data path is already dead. The transport reads `RTCPeerConnection.connectionState` and `iceConnectionState`; `disconnected` gets a 12-second recovery grace period, while `failed` is treated as terminal. A recovered `connected`/`completed` state cancels the grace timer. Actual `close` events still flow through the canonical per-peer cleanup path.
- There is no silent WebSocket relay fallback. A failed direct connection is reported to the user and console.

## NAT and availability limits

PeerJS Cloud is a free shared signalling service, not a TURN relay or a hosted game server. This build configures a public STUN server but does not supply TURN credentials. Some symmetric-NAT, firewall, VPN, school/work network, or restrictive mobile networks will not permit a direct peer-to-peer connection. In those cases the direct connection will fail and the lobby will display the connection error; there is no silent fallback. PeerJS Cloud availability and shared-service policies are outside the game's control.

References: [PeerJS Cloud](https://peerjs.com/server/cloud), [Peer API](https://peerjs.com/client/api/peer), [DataConnection API](https://peerjs.com/client/api/data-connection), [PeerJS FAQ](https://peerjs.com/client/faq), [MDN `connectionState`](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionState), [MDN `iceConnectionState`](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/iceConnectionState), and [PeerServer production considerations](https://peerjs.com/peerserver).

## Verification

Run `npm install`, `npm test`, `npm run lint`, and `npm run build`. The identity helper tests the fixed prefix, five-letter code validation, and cryptographic code sampling. A complete release check should also run two real browser instances on different networks; in-memory tests cannot prove that public PeerJS signalling, ICE, NAT traversal, and a full data-channel session all succeed end to end.


## Room lifecycle and liveness

Room phase is host-authoritative: `lobby` permits mode selection and match start, `playing` tracks connected participants as alive or defeated, and `results` freezes the outcome until the host creates a fresh lobby. Defeat is not a transport disconnect: the guest remains connected and continues chat and two-second heartbeat traffic. A real disconnect, explicit leave, host kick, or missed 25-second bidirectional liveness lease removes the participant and active assets using the same cleanup path; gray orphan structures are preserved as salvage. A later join is a new participant assignment, not a restored prior session.

The room roster is emitted immediately when identity, connectivity, or phase changes; its clock is coalesced to at most one update per second. The host's authoritative simulation and 30 Hz delta replication do not depend on this room-status UI timer.
