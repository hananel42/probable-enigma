# Structure targeting and defensive AI

## Selected structure

The HUD and world renderer must call the same `resolveContextBuilding` helper. A structure under the cursor wins when it is inside interaction range. If the cursor is not over an in-range structure, the closest structure in range is selected. If no structure is in range, there is no active structure target. The selected structure receives a solid high-contrast cyan footprint outline with a dark under-stroke and a subtle fill. Repair, upgrade, drone-mode, and dismantle controls must use the same resolved structure ID shown by the HUD.

## Damaged Core behavior

When a commander's own Core is damaged, repair is the highest strategic priority. If the commander can afford the repair, it commits to repair immediately and replans frequently. If it cannot afford the repair, it enters `GUARD_CORE`, returns to a defensive ring around the Core, and only pursues hostiles that threaten the Core; it must not leave for mining, hauling, construction, upgrades, or salvage while the Core remains damaged. Tactical self-defense can still fire at an enemy that enters weapon range.

## Escort drones

Drone flight always follows the same centre/radius physics. Escort drones use the live commander as the centre when no valid target is inside the commander's leash. A hostile in range becomes the centre; when it leaves the envelope or becomes invalid, the commander centre is restored immediately. Target acquisition range is measured from the home centre, not the drone. If a direct air corridor is blocked, A* supplies waypoints that are followed with the same acceleration and collision-aware integrator.
