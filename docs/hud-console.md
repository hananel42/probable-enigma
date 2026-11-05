# HUD Console Layout

The HUD is intentionally a compact machine-console overlay rather than a stack of large cards. It uses inline vector icons from `lucide-react`; do not use emoji glyphs for game status or resources.

## Layout regions

- **Top telemetry line** (`.hud-topline`): Core integrity, Commander vitals, wood and stone stockpiles, hostile-outpost status, threat level, elapsed time, and sound toggle. Health and resources are text readouts with thin meters, not large cards. It also hosts compact nearby/selected-structure identity, status/HP, group and current stat rows, plus icon-only doctrine controls only when an operational, context-targeted Drone Station can be managed. Do not display footprint dimensions, redundant upgrade history, or duplicate costs here.
- **Nearby structure action console** (`.hud-context`): Appears only when a structure is in sensor range. It focuses on upgrade choice details, costs/effects, and actions such as repair or salvage, without repeating block identity, status, HP, or live stats from the top telemetry line.
- **Deployment strip** (`.hud-build-strip`): Five compact build actions with SVG icons, cost, and the `1`–`5` keyboard labels. Keep scrollbars extremely thin and controls icon-only where the icon has a clear accessible label/title. It intentionally avoids tall card layouts so the game world remains visible.
- **Control legend** (`.hud-controls-line`): A low-profile footer. Keep labels short and use `<kbd>` styling for keys.

## Visual rules

- Use the existing cyan/emerald/amber/rose palette to distinguish information: cyan for systems and available actions, emerald for healthy/friendly/economy values, amber for costs or warnings, and rose for critical/hostile states.
- Use small SVG icons rather than emoji characters. Icons supplement explicit text; they never replace important meaning on their own.
- Prefer 1px separators, low-opacity backgrounds, restrained blur, and compact padding over rounded card stacks.
- Keep key labels readable at 9px or larger on mobile and 10px or larger on desktop where possible. Dense stat values should remain tabular and high contrast.
- Structure details must stay contextual and non-modal. Building actions are disabled when the Commander is dead or respawning.
- Upgrade choices are displayed in the same order as the shared upgrade catalog: `Q` is the first branch, `E` is the second branch, and `E` installs a linear upgrade. Do not add arrow-key upgrade selection because arrows are reserved for movement.

## Extending the HUD

New building stat rows should come from the building module's `inspect.ts` through `getBuildingStatLines`; do not duplicate game values or upgrade effects in JSX. Add a compact icon or a short descriptive phrase only if it exposes useful state. The nearby-structure identity and HP readout belongs in the upper telemetry bar immediately after the Core/Commander health readouts; do not duplicate identity, HP, status, distance, group, or upgrade cost in the side console. The compact side console focuses on upgrade choice descriptions, costs/effects, and repair/salvage actions. Use a thin scrollbar, preserve readable type, and let controls expose descriptive `aria-label` and `title` text without taking persistent horizontal space. Drone doctrine controls live in the top telemetry line only when the same contextual building resolver used by the cyan interaction outline identifies an operational Drone Station in range that the player is allowed to manage. The `C` hotkey uses this exact resolver; no persistent station selection or extra highlight frame is required. Keep the component presentational and route game changes through `GameEngine` callbacks.
