import type { Building, ResourceNode, Resources } from '../types';

export function createInitialResources(): Resources {
  return {
    wood: 125,
    stone: 125,
    diamonds: 0
  };
}

/**
 * Collect the stockpile from a harvester station into a faction's wallet.
 * Both the player and the autonomous enemy commander use this exact transfer
 * rule. Automated harvesters deposit only into the station; a commander may also
 * mine directly, but stored station cargo still requires a physical pickup.
 */
export function collectStationResources(station: Building, wallet: Resources): Resources {
  const requireNonNegative = (value: number, label: string) => {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and non-negative; received ${value}.`);
    return value;
  };
  const storedValue = (value: number | undefined, label: string) =>
    value === undefined ? 0 : requireNonNegative(value, label);
  const collected: Resources = {
    wood: storedValue(station.storedWood, `Station '${station.id}' stored wood`),
    stone: storedValue(station.storedStone, `Station '${station.id}' stored stone`),
    diamonds: 0
  };
  wallet.wood = requireNonNegative(wallet.wood, 'Wallet wood') + collected.wood;
  wallet.stone = requireNonNegative(wallet.stone, 'Wallet stone') + collected.stone;
  requireNonNegative(wallet.diamonds, 'Wallet diamonds');
  station.storedWood = 0;
  station.storedStone = 0;
  return collected;
}

/**
 * Extract a whole-number batch from a resource deposit. Any pre-existing
 * fractional remainder is rounded upward before extraction, so neither workers
 * nor commanders can leave fractions that later leak into the economy.
 */
export function takeWholeResourceBatch(node: ResourceNode, requestedAmount: number): number {
  if (!Number.isFinite(node.amount) || node.amount < 0) throw new RangeError(`Resource node '${node.id}' has invalid amount: ${node.amount}.`);
  if (!Number.isFinite(requestedAmount) || requestedAmount < 0) throw new RangeError(`Requested resource batch must be finite and non-negative; received ${requestedAmount}.`);
  const available = Math.ceil(node.amount);
  const requested = Math.ceil(requestedAmount);
  const amount = Math.min(available, requested);
  node.amount = Math.max(0, available - amount);
  return amount;
}
