/** Canonical simulation-rules entry point. Implementations live by responsibility in ./rules/. */
export { BUILDING_BLUEPRINTS, CORE_BLUEPRINT } from './content/buildingCatalog';
export * from './rules/constants';
export * from './rules/resources';
export * from './rules/buildingSpatialIndex';
export * from './rules/resourceSpatialIndex';
export * from './rules/geometry';
export * from './rules/economy';
export * from './rules/placement';
export * from './rules/entities';
