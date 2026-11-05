import { definition } from './definition';
import { behavior } from './behavior';
import { upgrades } from './upgrades';
import { upgradeScaling } from './upgradeScaling';
import { draw } from './draw';
import { getStatLines } from './inspect';
import type { BuildingModule } from '../types';
export const coreModule: BuildingModule = { definition, behavior, upgrades, upgradeScaling, draw, getStatLines };
