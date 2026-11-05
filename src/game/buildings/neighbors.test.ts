import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingInstance } from '../rules';
import { BuildingNeighborhoodIndex } from './neighbors';
import { buildingDrawer } from '../drawers/buildingDrawer';
import { BUILDING_MODULES } from './registry';

function wall(id: string, gx: number, gy: number, width = 1, height = 1) {
  const building = createBuildingInstance('WALL', 'player', gx, gy, id, 'test-group');
  building.widthInCells = width;
  building.heightInCells = height;
  return building;
}

test('building neighborhood finds all four cardinal edges and excludes diagonal contact', () => {
  const center = wall('center', 0, 0, 2, 2);
  const northWest = wall('north-west', 0, -1);
  const northEast = wall('north-east', 1, -1);
  const east = wall('east', 2, 0, 1, 2);
  const south = wall('south', 0, 2, 2, 1);
  const west = wall('west', -1, 0, 1, 2);
  const diagonal = wall('diagonal', -1, -1);
  const index = new BuildingNeighborhoodIndex([center, northWest, northEast, east, south, west, diagonal]);

  const neighbors = index.getNeighbors(center);
  assert.deepEqual(neighbors.north.map(building => building.id), ['north-west', 'north-east']);
  assert.deepEqual(neighbors.east.map(building => building.id), ['east']);
  assert.deepEqual(neighbors.south.map(building => building.id), ['south']);
  assert.deepEqual(neighbors.west.map(building => building.id), ['west']);
  assert.ok(!Object.values(neighbors).flat().some(building => building.id === 'diagonal'));
});

test('building neighborhood is symmetric, de-duplicated, and ignores destroyed structures', () => {
  const large = wall('large', 0, 0, 2, 2);
  const touching = wall('touching', 2, 0, 1, 2);
  const destroyed = wall('destroyed', 0, -1);
  destroyed.hp = 0;
  const index = new BuildingNeighborhoodIndex([large, touching, destroyed]);

  assert.deepEqual(index.getNeighbors(large).east.map(building => building.id), ['touching']);
  assert.deepEqual(index.getNeighbors(touching).west.map(building => building.id), ['large']);
  assert.deepEqual(index.getNeighbors(large).north, []);
  assert.deepEqual(index.getNeighbors(destroyed), { north: [], east: [], south: [], west: [] });
});

test('building modules receive the shared cardinal neighborhood through the drawing context', () => {
  const primary = wall('draw-primary', 0, 0);
  const eastern = wall('draw-east', 1, 0);
  const buildings = [primary, eastern];
  const module = BUILDING_MODULES.WALL;
  const originalDraw = module.draw;
  let receivedEastId: string | undefined;
  module.draw = context => { receivedEastId = context.neighbors.east[0]?.id; };
  const context = new Proxy({ filter: 'none', globalAlpha: 1 } as Record<string, unknown>, {
    get(target, property) { return property in target ? target[String(property)] : () => {}; },
    set(target, property, value) { target[String(property)] = value; return true; }
  }) as unknown as CanvasRenderingContext2D;
  try {
    const index = new BuildingNeighborhoodIndex(buildings);
    buildingDrawer.draw(context, primary, 0, undefined, false, buildings, index);
    assert.equal(receivedEastId, 'draw-east');
  } finally {
    module.draw = originalDraw;
  }
});
