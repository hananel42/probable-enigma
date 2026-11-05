# Named Groups and Alliances

## Group identity

Every `GameGroup` has a stable `id`, display `name`, `commanderName`, `faction`, `allianceId`, and presentation `color`. Ownership is tied to the group id/team id; diplomacy is tied to `allianceId`.

Use the authority command `SET_GROUP_IDENTITY` to update a group's display name, commander callsign, or color. Names are trimmed, control characters are removed, display lengths are capped, and colors must be six-digit hex values. Identity is display metadata only and cannot change ownership or economy.

## Diplomacy

Use `SET_GROUP_ALLIANCE` to set the group's shared alliance id. Distinct groups remain separate owners and retain their own wallets and construction rights, but groups with the same alliance id are not hostile to each other. Projectile collision, automated target selection, commander threat evaluation, and defensive drone alerts all use the shared hostility rules.

Alliance members are drawn in green. Their existing turrets and fire towers can still attack third-party hostiles, and drone alerts can bring idle allied defenders to a fight. Defensive patrol caches are invalidated when diplomacy changes so newly allied structures can join a shared defensive compound.

## Multiplayer security boundary

These are game-engine capabilities, not access control. A future network authority must authenticate which session owns each group id and authorize every identity/alliance command. Clients must not be allowed to rename or diplomatically reassign an arbitrary group by sending a raw command.
