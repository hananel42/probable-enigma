# Progression, Diamonds, and Building Upgrades

This document describes the current upgrade/economy rules in v1.16.58. The upgrade data is authored in English next to each building module; runtime behavior is implemented by shared systems and small building-specific adapters.

## Economy invariants

- The normal economy contains Wood and Stone. Diamonds are a special combat reward, not a mineable `ResourceType` and not a salvage material.
- A Diamond is awarded when a hostile Commander Core transitions from positive HP to zero HP. The authoritative engine records the rewarded Core ID, so repeated damage to the same destroyed Core cannot award another Diamond. Friendly Cores, ordinary structures, mining, and dismantling do not award Diamonds.
- The participant/group responsible for the lethal hit receives one Diamond in its own resource wallet. Multiplayer economies remain independent; Diamonds are not automatically pooled across a room.
- Every Core upgrade costs at least one Diamond plus Wood and Stone. `getBuildingUpgradeCost` enforces this rule even if a future Core option omits an explicit Diamond amount.
- Non-Core upgrades cannot consume Diamonds. A non-Core upgrade definition that attempts to charge Diamonds is rejected by the cost resolver.
- Core upgrades are not free repairs. Increasing Core maximum HP preserves its existing HP instead of healing it to the new maximum.

## Core progression

Core tiers are deliberately utility-first. Combat upgrades do not appear until the fourth Core level.

| Target level | Option | Cost (Wood / Stone / Diamonds) | Effect |
|---:|---|---:|---|
| 2 | Reinforced Matrix | 80 / 95 / 1 | Core maximum HP +25%. |
| 2 | Mining Accelerator | 110 / 60 / 1 | Commander mining speed +30%. |
| 3 | Efficient Extraction | 90 / 120 / 1 | Resource yield per mining batch +35%. |
| 3 | Swift Frame | 125 / 75 / 1 | Commander movement speed +12%. |
| 4 | Weapon Calibration | 145 / 135 / 1 | Commander damage +24%, mining yield -8%. |
| 4 | Rapid Trigger | 115 / 165 / 1 | Fire rate +22%, damage per shot -10%. |
| 5 | Siege Optics | 175 / 170 / 1 | Commander range +25%, damage per shot -8%. |
| 5 | Heavy Pulse | 145 / 205 / 1 | Commander damage +30%, firing interval +14%. |

There is one choice per tier. The tier becomes available by upgrading the Core; the combat options therefore require several earlier upgrades and several Core-destruction rewards.

## Auto-Turret

Unupgraded Commander and Auto-Turret use the same weapon baseline: 30 direct damage, a 0.18-second firing interval, 360 range, and 450 projectile speed. The base Commander has 150 HP; an Auto-Turret has 280 HP. The turret's baseline range was raised from the old 220-unit range so it can defend itself instead of letting a Commander shoot it from outside its response radius.

Each tier is a choice, and the chosen options are cumulative. This permits mixed paths such as Long-Barrel Optics → Guided Rounds → Explosive Ordnance → Rapid-Cycle Actuator.

| Target level | Option | Cost (Wood / Stone) | Effect / trade-off |
|---:|---|---:|---|
| 2 | Long-Barrel Optics | 75 / 70 | Range +35%, damage -8%. |
| 2 | Overcharged Rounds | 45 / 95 | Damage +30%, projectile speed -10%. |
| 3 | Twin-Barrel Assembly | 95 / 85 | Two spread shots per volley at 68% damage each; firing interval +12%. |
| 3 | Guided Rounds | 55 / 125 | Bounded homing; damage -10%, projectile speed -8%. Agile targets can still evade it. |
| 4 | High-Velocity Rounds | 105 / 105 | Projectile speed +38%, damage -5%. |
| 4 | Explosive Ordnance | 130 / 90 | 58-unit splash radius at 48% damage; direct-hit damage -18%. Splash respects alliances. |
| 5 | Rapid-Cycle Actuator | 145 / 130 | Fire rate +28%, damage per projectile -12%. |
| 5 | Reinforced Bearing | 115 / 165 | Maximum HP +25%, damage reduction +8 percentage points, firing interval +10%. |

The autonomous enemy upgrade policy prioritizes Long-Barrel Optics over Overcharged Rounds, intentionally extending hostile-turret reach to punish long-range kiting. Human players remain free to choose the damage branch.

## Effect Tower

The public building name is **Effect Tower**. `FIRE_TOWER` is the current schema’s internal type ID. It may be renamed directly across the current code and tests; when that changes serialized data, bump the world-save schema and reject older saves. No alias or migration is retained. Its behavior is an expanding pulse, not a flame-only weapon. Flashover adds animated copper coils, Rapid Wave accelerates the pulse animation, and Wide-Spectrum adds outer spectral rings; the effect arcs and emitters identify the currently installed modes. `towerEffectIds` stores the active effect mix, and the Effect Tower renderer uses the effect registry's palette and emitters to show combinations without adding a sprite per combination.

| Target level | Option | Cost (Wood / Stone) | Effect / trade-off |
|---:|---|---:|---|
| 2 | Cryogenic Surge | 55 / 105 | Adds a 42% slow for 2.8 s; pulse damage -12%. |
| 2 | Flashover Coils | 100 / 65 | Burning damage +40%, effect duration +20%, wave radius -8%. |
| 3 | Signal Suppression | 70 / 120 | Adds a 38% firing-rate reduction for 2.6 s; pulse damage -10%. |
| 3 | Weakening Wave | 115 / 75 | Adds a 35% outgoing-damage reduction for 2.8 s; radius -6%. |
| 4 | Radio Jammer | 85 / 145 | Drones take 24 damage/s and fire 50% slower; Commanders take 0.25 damage/s and fire 10% slower. Duration 2.2 s; firing interval +12%. |
| 4 | Corrosive Wave | 130 / 90 | Adds 4 damage/s and reduces effective armor to 65%; pulse damage -8%. |
| 5 | Wide-Spectrum Wave | 155 / 150 | Adds slow, suppression, and weakened shots to the current mix; radius -15%, pulse damage -15%, effect duration 2.5 s. |
| 5 | Rapid Wave Driver | 135 / 175 | Wave interval -28%, wave travel duration -20%, radius -10%. Existing effects stay installed. |

All Effect Tower modes are data-defined in `src/game/statusEffects/towerEffects.ts`. Add a new mode there first, then extend `TowerEffectId` and define a visual color/name/description. Upgrade options add modes with `ADD_TOWER_EFFECT`; this avoids one runtime branch for each combination.

## Wall

| Target level | Option | Cost (Wood / Stone) | Effect / trade-off |
|---:|---|---:|---|
| 2 | Reinforced Plating | 70 / 45 | Maximum HP +45%. |
| 2 | Reactive Armor | 45 / 85 | Damage reduction +18 percentage points, projectile reflection chance +12%. |
| 3 | Integrated Systems | Default tier cost | All applicable wall stats +12%. |
| 4 | Bastion Frame | 100 / 115 | Maximum HP +40%, damage reduction +5 percentage points. |
| 4 | Self-Repairing Alloy | 140 / 70 | Regenerates 8 HP/s while alive. |
| 5 | Mirror Weave | 125 / 165 | Reflection chance +30 percentage points, capped at 70%; maximum HP -12%. |
| 5 | Fortress Keystone | 165 / 145 | Maximum HP +30%, damage reduction +10 percentage points, regenerates 3 HP/s. |

Reflected projectiles switch to the wall's team/alliance, reverse direction, and receive a bounded return-range budget. They can hit the original attacker without causing friendly fire. Damage reduction and reflection have hard caps in the shared combat path.

## Drone Station and Harvester Station

Their current production/capacity branches remain unchanged in this release. Their upgrades continue to use the same option data, generic stat-effect interpreter, level curve, inspection API, and per-module renderer.

## Where to change things

- `src/game/buildings/<module>/upgrades.ts`: names, English descriptions, choices, costs, declarative effects, and AI preference (`aiPriority`). Upgrade IDs are current-schema history, not permanent identifiers; rename them directly and bump the save schema if serialized history changes.
- `src/game/upgrades/types.ts`: the closed union of supported building/Commander stats and effect operations.
- `src/game/upgrades/upgradeSystem.ts`: shared cost-independent effect interpretation, clamps, effect descriptions, and Core-to-Commander stat application.
- `src/game/rules.ts`: upgrade price enforcement, Diamond reservation, and core/non-core economy rules.
- `src/game/engine.ts`: authoritative Diamond reward attribution, projectile collisions, reflection, splash, and the human purchase transaction.
- `src/game/statusEffects/towerEffects.ts`: behavior, tuning, and visuals metadata for Effect Tower status modes.
- `src/game/buildings/<module>/draw.ts`: procedural module appearance. Use the current `upgradeIds` and active runtime stats; do not duplicate gameplay calculations here.
- `src/game/buildings/<module>/inspect.ts`: player-facing live stat details.
- `src/game/progressionCombatUpgrades.test.ts` and `src/game/buildings/upgradeVisualProfiles.test.ts`: upgrade economy, combat mechanics, current IDs/descriptions, and visual profiles.

When adding a stat, extend the relevant type, the generic effect interpreter/clamps, the owner building's initialization, inspector/rendering as appropriate, and focused tests. Prefer a data option composed from existing effects; add shared runtime behavior only when a mechanic cannot be expressed by the current effect set. Never add a one-off branch for a particular combination of installed upgrades.

## Balance notes

- Diamonds intentionally gate the Core progression and are granted for objectives, not resource gathering. The pacing therefore depends on how many hostile Cores a match contains and how aggressively players can reach them.
- The shared 360-unit base weapon range preserves exact Commander/turret stat parity while removing the old out-of-range turret weakness. Higher turret levels can specialize into still longer range at the cost of damage.
- Guided projectiles are rate-limited by turn speed and sacrifice damage/speed; explosive splash only affects hostile targets. These restrictions preserve dodge windows and prevent allied splash damage.
- Effect Tower upgrades trade raw pulse radius/damage against crowd control. Radio jamming is intentionally drone-heavy and barely harms Commanders.
- If testing shows turrets still feel too easy to kite, tune turret-only acquisition/aim behavior or add cover/synergy to its placement—not a hidden range bonus that would violate the documented baseline parity.
