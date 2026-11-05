import type { PathWaypoint } from './types';

/**
 * Parse waypoints received from a worker or another runtime boundary.
 *
 * The input is deliberately `unknown`: a TypeScript return annotation does not
 * validate structured-clone messages at runtime. This function returns canonical
 * objects containing only the fields the path follower consumes.
 */
export function parsePathWaypointRoute(value: unknown, context: string): PathWaypoint[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${context} must be an array of waypoints.`);
  }

  const parsed: PathWaypoint[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const candidate: unknown = value[index];
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new TypeError(`${context} contains an invalid waypoint at index ${index}: expected an object.`);
    }

    const fields = candidate as Record<string, unknown>;
    const gx = fields.gx;
    const gy = fields.gy;
    const x = fields.x;
    const y = fields.y;
    if (typeof gx !== 'number' || !Number.isSafeInteger(gx) ||
        typeof gy !== 'number' || !Number.isSafeInteger(gy)) {
      throw new TypeError(`${context} contains an invalid waypoint at index ${index}: gx and gy must be safe integers.`);
    }
    if (typeof x !== 'number' || !Number.isFinite(x) ||
        typeof y !== 'number' || !Number.isFinite(y)) {
      throw new TypeError(`${context} contains an invalid waypoint at index ${index}: x and y must be finite numbers.`);
    }

    parsed.push({ gx, gy, x, y });
  }

  return parsed;
}
