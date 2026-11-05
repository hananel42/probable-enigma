import { GameEntity, GameGroup, ResourceNode } from '../types';
import { ENTITY_CATALOG } from '../content/entityCatalog';

/**
 * Dedicated drawer for the commander, mining rovers, and aerial combat drones.
 */
export class EntityDrawer {
  public draw(
    ctx: CanvasRenderingContext2D,
    entity: GameEntity,
    resourceNodes: ResourceNode[],
    group?: GameGroup,
    allied = false,
    friendly = entity.faction === 'player'
  ) {
    if (entity.hp <= 0 && !entity.isDead) return;

    if (entity.kind === 'COMMANDER') {
      this.drawCommander(ctx, entity, resourceNodes, allied, friendly);
      if (group) this.drawCommanderNameplate(ctx, entity, group, allied, friendly);
    } else if (entity.kind === 'DRONE') {
      this.drawCombatDrone(ctx, entity, friendly);
    } else if (entity.kind === 'HARVESTER_BOT') {
      this.drawHarvesterBot(ctx, entity, resourceNodes, friendly);
    }

    if (allied && entity.kind !== 'COMMANDER' && !entity.isDead) {
      ctx.save();
      ctx.strokeStyle = '#4ade80';
      ctx.globalAlpha = 0.82;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(entity.x, entity.y, entity.radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Status visuals are driven by buff definitions; adding a buff can define its own marker.
    if (!entity.isDead) {
      const visibleBuffs = (entity.buffs ?? []).filter(buff => buff.remainingSeconds > 0 && buff.effect?.markerColor);
      visibleBuffs.forEach((buff, index) => {
        const color = buff.effect!.markerColor!;
        const markerY = entity.y - entity.radius - 10 - index * 6;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        if (buff.effect?.markerShape === 'ring') {
          ctx.beginPath(); ctx.arc(entity.x, markerY, 4, 0, Math.PI * 2); ctx.stroke();
        } else if (buff.effect?.markerShape === 'flame') {
          ctx.beginPath(); ctx.moveTo(entity.x, markerY - 4); ctx.quadraticCurveTo(entity.x + 5, markerY, entity.x, markerY + 4); ctx.quadraticCurveTo(entity.x - 4, markerY, entity.x, markerY - 4); ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(entity.x, markerY, 3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      });
    }

    // Health Bar
    if (entity.hp < entity.maxHp && !entity.isDead) {
      const hpRatio = Math.max(0, entity.hp / entity.maxHp);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(entity.x - 12, entity.y - entity.radius - 8, 24, 3);
      ctx.fillStyle = hpRatio > 0.5 ? '#22c55e' : '#ef4444';
      ctx.fillRect(entity.x - 12, entity.y - entity.radius - 8, 24 * hpRatio, 3);
    }
  }

  private drawCommanderNameplate(ctx: CanvasRenderingContext2D, commander: GameEntity, group: GameGroup, allied: boolean, friendly: boolean) {
    const isHostileHumanGroup = group.faction === 'player' && !friendly;
    const accent = allied ? '#4ade80' : (isHostileHumanGroup ? '#f43f5e' : group.color);
    const groupLabel = group.name.toUpperCase();
    const commanderLabel = group.commanderName.toUpperCase();
    ctx.save();
    ctx.font = '600 9px "Chakra Petch", monospace';
    const groupWidth = ctx.measureText(groupLabel).width;
    ctx.font = '700 10px "Chakra Petch", monospace';
    const commanderWidth = ctx.measureText(commanderLabel).width;
    const boxWidth = Math.min(220, Math.max(90, Math.max(groupWidth, commanderWidth) + 16));
    const boxHeight = 29;
    const left = commander.x - boxWidth / 2;
    const top = commander.y - commander.radius - 40;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
    ctx.fillRect(left, top, boxWidth, boxHeight);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, boxWidth, boxHeight);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 9px "Chakra Petch", monospace';
    ctx.fillStyle = allied ? '#bbf7d0' : accent;
    ctx.fillText(groupLabel, commander.x, top + 8.5, boxWidth - 10);
    ctx.font = '700 10px "Chakra Petch", monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(commanderLabel, commander.x, top + 20.5, boxWidth - 10);
    ctx.restore();
  }

  private drawCommander(
    ctx: CanvasRenderingContext2D,
    commander: GameEntity,
    resourceNodes: ResourceNode[],
    allied = false,
    friendly = commander.faction === 'player'
  ) {
    const isPlayer = commander.faction === 'player';
    const palette = ENTITY_CATALOG.COMMANDER.visual[friendly ? 'player' : 'enemy'];
    const mainCol = allied ? '#4ade80' : palette.primary;
    const opticCol = allied ? '#bbf7d0' : palette.secondary;
    const treadCol = allied ? '#14532d' : (friendly ? '#1e293b' : '#331b1e');

    if (commander.isDead) {
      ctx.fillStyle = mainCol;
      ctx.font = 'bold 13px Chakra Petch';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${isPlayer ? 'RESPAWNING' : 'ENEMY REBOOTING'} IN ${(commander.respawnTimer || 3).toFixed(1)}s`,
        commander.x,
        commander.y - 20
      );
      return;
    }

    // Active Mining Beam / Extraction Laser
    if (commander.isActivelyMining && commander.miningTargetId) {
      const targetRes = resourceNodes.find(r => r.id === commander.miningTargetId);
      if (targetRes) {
        ctx.strokeStyle = targetRes.type === 'wood' ? '#10b981' : mainCol;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(commander.x, commander.y);
        ctx.lineTo(targetRes.x, targetRes.y);
        ctx.stroke();

        // Beam core
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(commander.x, commander.y);
        ctx.lineTo(targetRes.x, targetRes.y);
        ctx.stroke();
      }
    }

    // Directional Mech Chassis
    ctx.save();
    ctx.translate(commander.x, commander.y);
    ctx.rotate(commander.angle);

    // Tread Pods
    ctx.fillStyle = treadCol;
    ctx.fillRect(-14, -15, 28, 6);
    ctx.fillRect(-14, 9, 28, 6);

    // Chassis
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = mainCol;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, commander.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Main Weapon Barrel
    ctx.fillStyle = mainCol;
    ctx.fillRect(0, -3.5, 17, 7);
    ctx.fillStyle = palette.trim;
    ctx.fillRect(10, -2, 8, 4);

    // Directional Optical Visor
    ctx.fillStyle = opticCol;
    ctx.beginPath();
    ctx.arc(4, 0, 5, -Math.PI / 2, Math.PI / 2);
    ctx.fill();

    ctx.restore();

    // Circular Mining Progress Meter
    if (commander.miningProgress && commander.miningProgress > 0) {
      ctx.strokeStyle = friendly ? '#10b981' : '#f59e0b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(
        commander.x,
        commander.y,
        commander.radius + 8,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * commander.miningProgress
      );
      ctx.stroke();
    }

    // AI tactical indicator for enemy commander
    if (!isPlayer && commander.aiGoal && commander.aiGoal !== 'IDLE') {
      ctx.fillStyle = '#fca5a5';
      ctx.font = '9px Chakra Petch';
      ctx.textAlign = 'center';
      const label = commander.aiGoal === 'GUARD_CORE' ? 'GUARD CORE' : commander.aiGoal.replace('_STRUCTURE', '').replace('_TARGET', '');
      ctx.fillText(label, commander.x, commander.y + commander.radius + 12);
    }
  }

  private drawCombatDrone(ctx: CanvasRenderingContext2D, drone: GameEntity, friendly: boolean) {
    const palette = ENTITY_CATALOG.DRONE.visual[friendly ? 'player' : 'enemy'];
    const col = palette.primary;
    const speed = Math.hypot(drone.vx || 0, drone.vy || 0);
    const speedRatio = Math.max(0, Math.min(1, speed / Math.max(1, drone.speed || 245)));
    if (drone.visualAngle !== undefined && !Number.isFinite(drone.visualAngle)) {
      throw new RangeError(`Drone '${drone.id}' has invalid visual angle: ${drone.visualAngle}.`);
    }
    if (!Number.isFinite(drone.angle)) throw new RangeError(`Drone '${drone.id}' has invalid angle: ${drone.angle}.`);
    const angle = drone.visualAngle ?? drone.angle;

    // Altitude shadow remains grounded while the hull is rendered as a directional aircraft.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.beginPath();
    ctx.ellipse(drone.x, drone.y + 14, 9 + speedRatio * 2, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(drone.x, drone.y);
    ctx.rotate(angle);

    // Exhaust trail length communicates acceleration and the craft's movement direction.
    if (speedRatio > 0.06) {
      const trailLength = 5 + speedRatio * 12;
      ctx.globalAlpha = 0.3 + speedRatio * 0.5;
      ctx.strokeStyle = palette.glow;
      ctx.lineWidth = 2 + speedRatio * 2;
      ctx.beginPath();
      ctx.moveTo(-5, -3);
      ctx.lineTo(-trailLength, -3);
      ctx.moveTo(-5, 3);
      ctx.lineTo(-trailLength, 3);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Thruster flare, hull, rotor arms, and a forward-facing optical wedge.
    ctx.fillStyle = palette.glow;
    ctx.beginPath();
    ctx.arc(0, 0, drone.radius + 3 + speedRatio * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, drone.radius + 2, drone.radius * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-12, -10);
    ctx.lineTo(12, 10);
    ctx.moveTo(12, -10);
    ctx.lineTo(-12, 10);
    ctx.stroke();

    // The nose marker gives the drone an obvious facing direction even when hovering.
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(5, -4);
    ctx.lineTo(6, 0);
    ctx.lineTo(5, 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(2, 0, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawHarvesterBot(
    ctx: CanvasRenderingContext2D,
    bot: GameEntity,
    resourceNodes: ResourceNode[],
    friendly = bot.faction === 'player'
  ) {
    const palette = ENTITY_CATALOG.HARVESTER_BOT.visual[friendly ? 'player' : 'enemy'];
    const col = palette.primary;

    // Mining Laser if currently extracting
    if (bot.harvesterState === 'MINING' && bot.targetResourceId) {
      const targetRes = resourceNodes.find(r => r.id === bot.targetResourceId);
      if (targetRes) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bot.x, bot.y);
        ctx.lineTo(targetRes.x, targetRes.y);
        ctx.stroke();
      }
    }

    // Rover Chassis
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(bot.x - 10, bot.y - 10, 20, 20);

    ctx.fillStyle = col;
    ctx.fillRect(bot.x - 7, bot.y - 7, 14, 14);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(bot.x - 3, bot.y - 3, 6, 6);

    // Cargo indicator bar if carrying resources
    if (bot.cargoAmount && bot.cargoAmount > 0) {
      const cargoRatio = bot.cargoAmount / (bot.cargoCapacity || 20);
      ctx.fillStyle = bot.cargoType === 'wood' ? '#10b981' : '#94a3b8';
      ctx.fillRect(bot.x - 8, bot.y + 12, 16 * cargoRatio, 3);
    }
  }


}

export const entityDrawer = new EntityDrawer();
