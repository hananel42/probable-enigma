# Player Navigation and Visual Identity

## Ownership and identity

This feature is owned by the Canvas presentation layer. `src/game/client/playerPresentation.ts` derives navigation targets and local alliance relationships from the current `GameEngineState`. `src/game/client/playerBaseHUDIndicators.ts` draws those targets in screen space, while `CanvasGameRenderer.ts` invokes the helper after the world transform. These modules do not mutate the world, affect target selection, or introduce a new network/persistence field.

The local participant is resolved by matching `state.player.id` to `EngineHumanPlayer.commanderId` (or the projected Commander owner ID). The local participant's `coreId` identifies the home Core. Other participants are represented by their own `coreId`, and a Core is shown only once even when several participants share it. This is why CO-OP displays one home indicator and no duplicate teammate-base arrows. TEAM and FFA participants with distinct Cores each receive an additional marker.

The current Core object's world coordinates are read every render, so FFA spawn placement, Core revival, and camera movement do not require cached navigation coordinates. A destroyed Core remains a valid location marker while the Core object remains in the world; its label includes `DOWN`.

## Indicator presentation

`CanvasGameRenderer` draws the arrows after leaving the world transform, in screen coordinates. The marker therefore stays readable at different camera zoom levels. A Core inside the viewport gets a downward marker above its position. An off-screen Core gets a directional arrow on the nearest safe viewport edge, a participant/home label, and distance in blocks.

| Relationship | Indicator color | Meaning |
|---|---|---|
| Local home | `#38bdf8` | Your Core |
| Same alliance | `#4ade80` | Friendly participant Core |
| Different alliance | `#f43f5e` | Hostile participant Core |

The same relationship distinction is used by `EntityDrawer`. Human commanders are all created with faction `player`, including FFA opponents, so rendering must use the participant's group/alliance relationship rather than faction alone. Same-group commanders use the friendly player palette; other allied groups use the shared green palette; hostile human groups use the enemy red palette. Their drones and harvesters use the corresponding friendly/enemy unit palette.

## Validation

The focused regression suites are `src/game/client/playerPresentation.test.ts` and `src/game/client/CanvasGameRenderer.test.ts`. They cover distinct TEAM bases, hostile FFA bases, shared CO-OP Core de-duplication, alliance resolution, visible home/base labels, and friendly/hostile Commander rendering. Run `npm test` and `npm run docs:check`.
