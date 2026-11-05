import { CommanderAIUpdate } from './commanderAI/CommanderAIUpdate';
export type { CommanderActionFeedback } from './commanderAI/model';



/**
 * Symmetrical Commander AI:
 * Controls the Enemy Commander Robot using the EXACT same capabilities, actions,
 * building blueprints, mining channels, repair costs, and drone commands as the Player.
 */
export class CommanderAI extends CommanderAIUpdate  {}

export const commanderAI = new CommanderAI();
