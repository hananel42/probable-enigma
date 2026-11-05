/** Public player-name rules shared by the lobby and host-side validation. */
const ROBOT_PREFIXES = [
  'Wobble', 'Quantum', 'Rusty', 'Glitch', 'Crank', 'Blinky', 'Sprocket',
  'Mumble', 'Turbo', 'Noodle', 'Cosmic', 'Jitter', 'Bleep', 'Scrap', 'Velcro'
] as const;
const ROBOT_UNITS = [
  'Toaster', 'SocketGoblin', 'BoltMuffin', 'PacketWeasel', 'ServoPigeon',
  'LaserTurnip', 'DustBunny', 'CircuitMoth', 'GearFerret', 'NullBot',
  'WrenchWizard', 'CopperNoodle', 'HeapOfBolts', 'RadioPickle', 'FluxPossum'
] as const;

export function normalizeDisplayName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > 24 || !/^[\p{L}\p{N} _'-]+$/u.test(normalized)) {
    throw new TypeError('Player name must be 1–24 characters and contain only letters, numbers, spaces, underscores, apostrophes, or hyphens.');
  }
  return normalized;
}

/** Generate an English robot nickname; cryptographic randomness is not required for cosmetic names. */
export function createRandomRobotName(random: () => number = Math.random): string {
  const prefix = ROBOT_PREFIXES[Math.floor(random() * ROBOT_PREFIXES.length)];
  const unit = ROBOT_UNITS[Math.floor(random() * ROBOT_UNITS.length)];
  const serial = Math.floor(random() * 90) + 10;
  if (!prefix || !unit) throw new Error('Robot-name generator received an out-of-range random value.');
  const name = `${prefix} ${unit}-${serial}`;
  if (name.length > 24) {
    throw new Error(`Robot-name catalog generated ${name.length} characters; names must not exceed 24 characters.`);
  }
  return name;
}

/** Blank names are resolved once when the player starts or joins a session. */
export function resolveDisplayName(value: string): string {
  return value.trim() ? normalizeDisplayName(value) : createRandomRobotName();
}
