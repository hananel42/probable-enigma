# Building neighborhood API

## Purpose

Building renderers may need to change their silhouettes based on the four structures touching a building's north, east, south, or west edge. The shared neighborhood API provides that information without adding building-type checks to the engine or copying adjacency scans into each renderer.

## Contract

- `BuildingNeighborhoodIndex` is created once per render pass from the current building list.
- `getNeighbors(building)` returns a `BuildingNeighborhood` with `north`, `east`, `south`, and `west` arrays.
- Adjacency is footprint-aware and cell-based. A neighbor must touch an edge; corner/diagonal contact is not adjacency.
- An edge can contain multiple neighboring structures, such as two one-cell walls along the side of a two-cell building.
- Destroyed structures (`hp <= 0`) are excluded from the index. The API does not automatically filter by type, faction, team, alliance, or Core ownership; the building module decides which neighbors matter to its visual rule.
- Neighbor arrays are deterministic in edge traversal order and de-duplicated by building ID.

## Use from a building renderer

`BuildingDrawContext` receives the computed `neighbors` value:

```ts
export function draw({ ctx, building, neighbors, left, top, width, height }: BuildingDrawContext) {
  const joinsWallNorth = neighbors.north.some(neighbor =>
    neighbor.type === 'WALL' && neighbor.teamId === building.teamId
  );
  // Draw a shared cap/connector only when joinsWallNorth is true.
}
```

This example illustrates a renderer policy only. Do not add visual special cases to `GameEngine` or `CanvasGameRenderer`. The renderer constructs one `BuildingNeighborhoodIndex` and supplies it to the common `BuildingDrawer`; modules receive the same read-only context as the rest of their drawing inputs.

## Adding tests

Add tests to `src/game/buildings/neighbors.test.ts` for cardinal direction, footprint boundaries, multiple neighbors along one edge, diagonals, destroyed neighbors, and module context wiring. Avoid Canvas pixel snapshots for topology rules; test the neighbor data directly.
