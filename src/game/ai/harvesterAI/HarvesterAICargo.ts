import type { Building, GameEntity } from '../../types';
import { HarvesterAIResourceSelection } from './HarvesterAIResourceSelection';

export abstract class HarvesterAICargo extends HarvesterAIResourceSelection {

  protected override depositCargo(
    bot: GameEntity,
    station: Building,
    onDeposit?: (station: Building, wood: number, stone: number) => void
  ) {
    const amount = Math.max(0, bot.cargoAmount || 0);
    const type = bot.cargoType;
    if (!type || amount <= 0) return;

    const capacity = Math.max(0, station.maxCapacity || 75);
    const stored = type === 'wood' ? (station.storedWood || 0) : (station.storedStone || 0);
    const accepted = Math.min(amount, Math.max(0, capacity - stored));
    if (accepted <= 0) return;

    if (type === 'wood') station.storedWood = stored + accepted;
    else station.storedStone = stored + accepted;
    onDeposit?.(station, type === 'wood' ? accepted : 0, type === 'stone' ? accepted : 0);

    const remaining = amount - accepted;
    bot.cargoAmount = remaining;
    if (remaining <= 0) bot.cargoType = null;
  }
}
