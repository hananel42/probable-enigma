import { findFreeAdjacentSpawnPosition } from '../rules';
import { sound } from '../audio';
import { miningSystem } from '../mining/miningSystem';
import { applyEntityDamage, getCombatTeamId } from '../combat';
import { moveCommanderWithCollision } from '../movement';
import { getBuffMultiplier, tickBuffs } from '../statusEffects/buffSystem';
import { BASE_WEAPON_TUNING } from '../combatTuning';
import { EngineSimulation } from './EngineSimulation';

export abstract class EngineSinglePlayer extends EngineSimulation {


  protected override updateSinglePlayer(dt: number) {
    const { player } = this.state;
    const participant = this.state.humanPlayers.find(candidate => candidate.commanderId === player.id);

    // A destroyed/missing Core ends this participant's run. Do not respawn at
    // the fallback position or allow the dead outpost to keep issuing commands.
    if (participant && this.isParticipantDefeated(participant.playerId)) {
      if (participant.playerId === 'player-host') this.state.isGameOver = true;
      this.retireDefeatedParticipant(participant);
      return;
    }

    // A zero-HP commander must always enter the death state, regardless of the
    // damage source (projectiles, fire, or future status effects).
    if (!player.isDead && player.hp <= 0) {
      player.isDead = true;
      player.hp = 0;
      player.respawnTimer = Math.max(player.respawnTimer || 0, 3);
    }

    // Handle Death & 3-Second Respawn before status effects; a dead commander
    // cannot continue taking burn damage while waiting to respawn.
    if (player.isDead) {
      player.hp = 0;
      this.state.selectedBuildingType = null;
      this.state.selectedStationId = null;
      this.isPointerDown = false;
      player.respawnTimer = Math.max(0, (player.respawnTimer || 0) - dt);
      if (player.respawnTimer <= 0) {
        const participant = this.state.humanPlayers.find(candidate => candidate.commanderId === player.id);
        if (!participant) throw new Error(`Cannot respawn commander '${player.id}': no human participant owns this commander.`);
        const core = this.state.buildings.find(b => b.type === 'CORE' && b.hp > 0 && b.id === participant.coreId);
        if (!core) throw new Error(`Cannot respawn commander '${player.id}': participant '${participant.playerId}' has no operational Core '${participant.coreId}'.`);
        const spawn = findFreeAdjacentSpawnPosition(core, false, this.state.buildings, this.state.resourceNodes);
        player.x = spawn.x;
        player.y = spawn.y;
        player.hp = player.maxHp;
        player.isDead = false;
        player.vx = 0;
        player.vy = 0;
        sound.playMine();
        this.addFloatingText(player.x, player.y - 20, 'RESPAWNED AT COMMAND CORE', '#4ade80');
      }
      return;
    }

    // Status effects are data-driven and share the standard damage/healing path.
    const playerBuffTick = tickBuffs(player, dt);
    if (playerBuffTick.healthDelta < 0) {
      const result = applyEntityDamage(player, -playerBuffTick.healthDelta);
      if (result.becameLethal) {
        this.createSparks(player.x, player.y, '#f43f5e', 14);
        sound.playExplosion(false);
        return;
      }
    } else if (playerBuffTick.healthDelta > 0) {
      player.hp = Math.min(player.maxHp, player.hp + playerBuffTick.healthDelta);
    }
    for (const effect of playerBuffTick.particles) this.createSparks(player.x, player.y, effect.color, effect.count, effect.size);

    // WASD Movement
    let mx = 0;
    let my = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) my -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) my += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) mx -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) mx += 1;

    if (mx !== 0 && my !== 0) {
      mx *= 0.7071;
      my *= 0.7071;
    }

    if (mx !== 0 || my !== 0) {
      if (!this.state.isMouseAiming) {
        player.angle = Math.atan2(my, mx);
      }
    }

    if (this.state.isMouseAiming) {
      player.angle = Math.atan2(this.state.mouseWorld.y - player.y, this.state.mouseWorld.x - player.x);
    }

    // Move player with ground collision
    moveCommanderWithCollision(player, mx, my, dt, this.state.buildings, this.state.resourceNodes);

    // 1. Process Mining System FIRST to cleanly decouple mining from firing!
    const wantsToMineKey = Boolean(this.keys['KeyF'] || this.keys['KeyJ']);
    const miningResult = miningSystem.updatePlayerMining(
      player,
      this.state.resourceNodes,
      this.state.mouseWorld,
      wantsToMineKey,
      this.isPointerDown,
      Boolean(this.state.selectedBuildingType),
      dt
    );

    if (miningResult.harvested) {
      this.state.resources[miningResult.harvested.type] += miningResult.harvested.amount;
      this.addFloatingText(
        player.x,
        player.y - 25,
        `+${miningResult.harvested.amount} ${miningResult.harvested.type.toUpperCase()}`,
        '#38bdf8'
      );
      this.createSparks(
        player.x,
        player.y,
        miningResult.harvested.type === 'wood' ? '#10b981' : '#94a3b8',
        8
      );
      this.triggerStateChange();
    }

    // 2. Weapon Fire ONLY if NOT actively mining and NOT placing buildings!
    const wantsToShoot = (this.isPointerDown || this.keys['Space']) && !this.state.selectedBuildingType && !player.isActivelyMining;
    player.lastFireTime = (player.lastFireTime || 0) + dt;

    if (wantsToShoot && player.lastFireTime >= (player.fireCooldown || 0.18) / getBuffMultiplier(player, 'fireRateMultiplier')) {
      this.firePlayerWeapon();
      player.lastFireTime = 0;
    }
  }


  protected override firePlayerWeapon() {
    const { player } = this.state;
    const muzzleX = player.x + Math.cos(player.angle) * 19;
    const muzzleY = player.y + Math.sin(player.angle) * 19;
    const speed = BASE_WEAPON_TUNING.projectileSpeed;
    const weaponRange = player.range || BASE_WEAPON_TUNING.range;

    this.state.projectiles.push({
      id: `proj-${Date.now()}-${Math.random()}`,
      ownerPlayerId: player.ownerPlayerId,
      x: muzzleX,
      y: muzzleY,
      rangeOriginX: player.x,
      rangeOriginY: player.y,
      maxRange: weaponRange,
      vx: Math.cos(player.angle) * speed,
      vy: Math.sin(player.angle) * speed,
      damage: (player.damage || 30) * getBuffMultiplier(player, 'powerMultiplier'),
      faction: 'player',
      teamId: getCombatTeamId(player),
      allianceId: player.allianceId || getCombatTeamId(player),
      color: '#38bdf8',
      radius: 4,
      life: Math.min(1.2, weaponRange / speed),
      maxLife: Math.min(1.2, weaponRange / speed)
    });

    sound.playShoot();
    this.createSparks(muzzleX, muzzleY, '#38bdf8', 4);
  }
}
