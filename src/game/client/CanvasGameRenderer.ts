import type { GameEngineState } from '../engine';
import type { GameGroup } from '../types';
import { areGroupsAllied, getGroupDisplayColor } from '../groups';
import { isGroupFriendlyToParticipant } from './playerPresentation';
import { drawPlayerBaseHUDIndicators } from './playerBaseHUDIndicators';
import { GRID_SIZE, getResourceNodesInCellBounds } from '../rules';
import { resourceDrawer } from '../drawers/resourceDrawer';
import { buildingDrawer } from '../drawers/buildingDrawer';
import { BuildingNeighborhoodIndex } from '../buildings/neighbors';
import { entityDrawer } from '../drawers/entityDrawer';
import { effectDrawer } from '../drawers/effectDrawer';
import { distance } from '../rules';
import { resolveContextBuilding } from '../buildingSelection';
import { measurePerformance } from '../performance/PerformanceDiagnostics';

function isVisibleBuilding(
  building: { x: number; y: number; widthInCells?: number; heightInCells?: number },
  viewLeft: number, viewRight: number, viewTop: number, viewBottom: number
): boolean {
  const halfWidth = ((building.widthInCells || 1) * GRID_SIZE) * 0.5;
  const halfHeight = ((building.heightInCells || 1) * GRID_SIZE) * 0.5;
  return !(building.x + halfWidth < viewLeft || building.x - halfWidth > viewRight ||
    building.y + halfHeight < viewTop || building.y - halfHeight > viewBottom);
}

/**
 * Browser-only presentation layer. It reads authoritative snapshots but never
 * mutates game rules or makes gameplay decisions.
 */
export class CanvasGameRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private visibleProjectiles: GameEngineState['projectiles'] = [];
  private visibleParticles: GameEngineState['particles'] = [];
  private viewportWidth = 1;
  private viewportHeight = 1;
  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D context not available');
    this.ctx = context;
  }

  /** Draw the latest authoritative snapshot to the local canvas. */
  public draw(state: Readonly<GameEngineState>): void {
    const { ctx, canvas } = this;
    const rect = canvas.getBoundingClientRect();
    this.viewportWidth = Math.max(1, rect.width || canvas.clientWidth || canvas.width);
    this.viewportHeight = Math.max(1, rect.height || canvas.clientHeight || canvas.height);

    // Keep CSS-pixel world coordinates consistent while limiting the backing
    // store to the canvas sizing helper's capped DPR. setTransform replaces the
    // current transform; it does not replace the Canvas state stack.
    ctx.setTransform(canvas.width / this.viewportWidth, 0, 0, canvas.height / this.viewportHeight, 0, 0);
    const { camera } = state;
    const groupById = measurePerformance('render.buildGroupIndex', () => new Map<string, GameGroup>(state.groups.map(group => [group.id, group])), { groupCount: state.groups.length });
    // Neighbor geometry is stable for the duration of this frame; build one
    // shared index instead of scanning the entire building list per structure.
    const buildingNeighborhoods = measurePerformance('render.buildingNeighborhoodIndex', () => new BuildingNeighborhoodIndex(state.buildings), { buildingCount: state.buildings.length });
    const localParticipant = state.humanPlayers.find(participant =>
      participant.commanderId === state.player.id || participant.playerId === state.player.ownerPlayerId
    );
    if (!localParticipant) {
      throw new Error(`Canvas renderer cannot resolve local participant for Commander '${state.player.id}'.`);
    }
    const playerGroup = groupById.get(localParticipant.groupId);
    const groupFor = (thing: { teamId?: string; faction: string }) => groupById.get(thing.teamId || thing.faction);

    ctx.clearRect(0, 0, this.viewportWidth, this.viewportHeight);

    const zoom = Math.max(0.25, camera.zoom);
    const halfWorldWidth = this.viewportWidth / zoom / 2;
    const halfWorldHeight = this.viewportHeight / zoom / 2;
    const viewLeft = camera.x - halfWorldWidth - GRID_SIZE * 2;
    const viewRight = camera.x + halfWorldWidth + GRID_SIZE * 2;
    const viewTop = camera.y - halfWorldHeight - GRID_SIZE * 2;
    const viewBottom = camera.y + halfWorldHeight + GRID_SIZE * 2;
    const visibleResources = measurePerformance('render.resourceVisibilityQuery', () => getResourceNodesInCellBounds(
      state.resourceNodes,
      Math.floor(viewLeft / GRID_SIZE), Math.floor(viewTop / GRID_SIZE),
      Math.floor(viewRight / GRID_SIZE), Math.floor(viewBottom / GRID_SIZE),
      true
    ), { worldResourceCount: state.resourceNodes.length });

    // Every frame owns exactly one world transform scope. The finally block is
    // essential: without it, save() state accumulated indefinitely at 60 FPS.
    ctx.save();
    try {
      ctx.translate(this.viewportWidth / 2, this.viewportHeight / 2);
      ctx.scale(camera.zoom, camera.zoom);
      ctx.translate(-camera.x, -camera.y);

      measurePerformance('render.terrain', () => this.renderGridAndTerrain(state));
      measurePerformance('render.resources', () => {
        for (const node of visibleResources) resourceDrawer.draw(ctx, node);
      }, { visibleResourceCount: visibleResources.length });

      measurePerformance('render.buildings', () => {
        for (const building of state.buildings) {
          if (!isVisibleBuilding(building, viewLeft, viewRight, viewTop, viewBottom)) continue;
          const group = groupFor(building);
          buildingDrawer.draw(ctx, building, state.gameTime, group, areGroupsAllied(group, playerGroup), state.buildings, buildingNeighborhoods);
        }
      }, { buildingCount: state.buildings.length });

      // The commander and autonomous units live in `entities`; drawing only
      // terrain/buildings leaves the whole game world looking empty. De-duplicate
      // by ID and explicitly include state.player so a projected local commander
      // is rendered even if a transport frame omitted it from the entity array.
      measurePerformance('render.entities', () => {
        const entitiesById = new Map<string, GameEngineState['entities'][number]>();
        for (const entity of state.entities) entitiesById.set(entity.id, entity);
        entitiesById.set(state.player.id, state.player);
        for (const entity of entitiesById.values()) {
          const radius = Math.max(0, entity.radius ?? 0);
          if (entity.x + radius < viewLeft || entity.x - radius > viewRight || entity.y + radius < viewTop || entity.y - radius > viewBottom) continue;
          const group = groupFor(entity);
          const allied = areGroupsAllied(group, playerGroup);
          const friendly = isGroupFriendlyToParticipant(group, localParticipant) || entity.ownerPlayerId === localParticipant.playerId;
          entityDrawer.draw(ctx, entity, state.resourceNodes, group, allied, friendly);
        }
      }, { entityCount: state.entities.length });

      measurePerformance('render.effects', () => {
        this.visibleProjectiles = state.projectiles.filter(projectile =>
          projectile.x + projectile.radius >= viewLeft && projectile.x - projectile.radius <= viewRight &&
          projectile.y + projectile.radius >= viewTop && projectile.y - projectile.radius <= viewBottom
        );
        effectDrawer.drawProjectiles(ctx, this.visibleProjectiles);

        this.visibleParticles = state.particles.filter(particle =>
          particle.x + particle.size >= viewLeft && particle.x - particle.size <= viewRight &&
          particle.y + particle.size >= viewTop && particle.y - particle.size <= viewBottom
        );
        effectDrawer.drawParticles(ctx, this.visibleParticles);
        const visibleFloatingTexts = state.floatingTexts.filter(text =>
          text.x >= viewLeft && text.x <= viewRight && text.y >= viewTop && text.y <= viewBottom
        );
        effectDrawer.drawFloatingTexts(ctx, visibleFloatingTexts);
      }, { projectileCount: state.projectiles.length, particleCount: state.particles.length, floatingTextCount: state.floatingTexts.length });

      if (state.selectedBuildingType) {
        effectDrawer.drawPlacementOverlay(
          ctx,
          state.selectedBuildingType,
          state.mouseWorld.gx,
          state.mouseWorld.gy,
          state.buildings,
          state.resourceNodes,
          state.resources
        );
      }

      // Highlight the exact structure chosen by the HUD/action targeting rules.
      const contextBuilding = resolveContextBuilding(state.buildings, state.player, state.mouseWorld);
      if (contextBuilding) {
        const left = contextBuilding.gx * GRID_SIZE;
        const top = contextBuilding.gy * GRID_SIZE;
        const width = (contextBuilding.widthInCells || 1) * GRID_SIZE;
        const height = (contextBuilding.heightInCells || 1) * GRID_SIZE;
        ctx.save();
        try {
          const inverseZoom = 1 / zoom;
          ctx.fillStyle = 'rgba(34, 211, 238, 0.075)';
          ctx.fillRect(left - 2, top - 2, width + 4, height + 4);
          ctx.setLineDash([]);
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(2, 6, 23, 0.95)';
          ctx.lineWidth = 5 * inverseZoom;
          ctx.strokeRect(left - 3, top - 3, width + 6, height + 6);
          ctx.strokeStyle = '#67e8f9';
          ctx.lineWidth = 2.5 * inverseZoom;
          ctx.shadowColor = '#22d3ee';
          ctx.shadowBlur = 8 * inverseZoom;
          ctx.strokeRect(left - 3, top - 3, width + 6, height + 6);
        } finally {
          ctx.restore();
        }
      }
    } finally {
      ctx.restore();
    }

    // These are screen-space HUD hints and must be drawn after restoring the
    // world transform, otherwise their coordinates are transformed twice.
    drawPlayerBaseHUDIndicators(ctx, state, this.viewportWidth, this.viewportHeight);
    this.renderEnemyBaseHUDIndicators(ctx, state, groupById, playerGroup);
  }

  private renderEnemyBaseHUDIndicators(
    ctx: CanvasRenderingContext2D,
    state: Readonly<GameEngineState>,
    groupById: Map<string, GameGroup>,
    playerGroup?: GameGroup
  ) {
    const { camera, player, enemyBases } = state;
    const cx = this.viewportWidth / 2;
    const cy = this.viewportHeight / 2;
    const margin = 48;
    const halfW = this.viewportWidth / 2 - margin;
    const halfH = this.viewportHeight / 2 - margin;

    for (const base of enemyBases) {
      if (base.isDestroyed) continue;

      // Enemy Base screen position
      const screenX = (base.x - camera.x) * camera.zoom + cx;
      const screenY = (base.y - camera.y) * camera.zoom + cy;

      const isInside =
        screenX >= margin &&
        screenX <= this.viewportWidth - margin &&
        screenY >= margin &&
        screenY <= this.viewportHeight - margin;

      const distMeters = Math.round(distance(player.x, player.y, base.x, base.y) / GRID_SIZE);
      const stance = base.stance || 'FORTIFYING';
      const group = groupById.get(base.teamId || base.id);
      const allied = areGroupsAllied(group, playerGroup);
      const accent = allied ? getGroupDisplayColor(group, state.groups) : (base.groupColor || group?.color || '#f43f5e');
      const groupName = base.groupName || group?.name || 'UNIDENTIFIED GROUP';
      const commanderName = base.commanderName || group?.commanderName || 'COMMANDER UNKNOWN';

      if (!isInside) {
        // Offscreen Directional Indicator Arrow
        const dx = screenX - cx;
        const dy = screenY - cy;
        const angle = Math.atan2(dy, dx);

        const absCos = Math.abs(Math.cos(angle));
        const absSin = Math.abs(Math.sin(angle));

        let edgeX = cx;
        let edgeY = cy;

        if (halfW * absSin <= halfH * absCos) {
          const signX = Math.sign(Math.cos(angle));
          edgeX = cx + signX * halfW;
          edgeY = cy + signX * halfW * Math.tan(angle);
        } else {
          const signY = Math.sign(Math.sin(angle));
          edgeY = cy + signY * halfH;
          edgeX = cx + (signY * halfH) / Math.tan(angle);
        }

        ctx.save();
        ctx.translate(edgeX, edgeY);

        // Pulsing radar glow
        const pulse = (Math.sin(state.gameTime * 4.5) + 1) * 0.5;
        ctx.fillStyle = allied ? `rgba(74, 222, 128, ${0.18 + pulse * 0.3})` : `rgba(244, 63, 94, ${0.2 + pulse * 0.35})`;
        ctx.beginPath();
        ctx.arc(0, 0, 20 + pulse * 6, 0, Math.PI * 2);
        ctx.fill();

        // Directional chevron points toward the named group base
        ctx.rotate(angle);

        ctx.fillStyle = accent;
        ctx.strokeStyle = allied ? '#dcfce7' : '#fecdd3';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(18, 0);
        ctx.lineTo(-10, -11);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-10, 11);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();

        // Distance & Status Label beside the indicator
        ctx.save();
        ctx.font = 'bold 10px Chakra Petch';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textOffsetX = Math.cos(angle) * -36;
        const textOffsetY = Math.sin(angle) * -36;
        const labelX = edgeX + textOffsetX;
        const labelY = edgeY + textOffsetY;

        const labelWidth = 152;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.fillRect(labelX - labelWidth / 2, labelY - 16, labelWidth, 32);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.strokeRect(labelX - labelWidth / 2, labelY - 16, labelWidth, 32);

        ctx.fillStyle = accent;
        ctx.font = 'bold 9px Chakra Petch';
        ctx.fillText(`${groupName} · ${distMeters} BLK`, labelX, labelY - 5, labelWidth - 8);
        ctx.font = '8px Chakra Petch';
        ctx.fillStyle = stance === 'ASSAULT' ? '#fb7185' : (stance === 'DEFENDING' ? '#fbbf24' : '#94a3b8');
        ctx.fillText(`${commanderName} · ${stance}`, labelX, labelY + 8, labelWidth - 8);

        ctx.restore();
      } else {
        // On-screen beacon badge identifies the group and its commander
        ctx.save();
        ctx.translate(screenX, screenY - 52);

        const pulse = (Math.sin(state.gameTime * 4.0) + 1) * 0.5;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;

        // Downward tactical red chevron
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(0, 10 + pulse * 4);
        ctx.lineTo(-9, -2);
        ctx.lineTo(9, -2);
        ctx.closePath();
        ctx.fill();

        ctx.font = 'bold 10px Chakra Petch';
        ctx.textAlign = 'center';
        ctx.fillStyle = accent;
        ctx.fillText(groupName, 0, -10, 220);
        ctx.font = '9px Chakra Petch';
        ctx.fillStyle = allied ? '#bbf7d0' : '#cbd5e1';
        ctx.fillText(`${commanderName} · ${stance}`, 0, 3, 220);

        ctx.restore();
      }
    }
  }

  private renderGridAndTerrain(state: Readonly<GameEngineState>) {
    const { ctx } = this;
    const { camera } = state;
    const zoom = Math.max(0.25, camera.zoom);
    const halfWorldWidth = this.viewportWidth / zoom / 2;
    const halfWorldHeight = this.viewportHeight / zoom / 2;
    const left = camera.x - halfWorldWidth - 50;
    const right = camera.x + halfWorldWidth + 50;
    const top = camera.y - halfWorldHeight - 50;
    const bottom = camera.y + halfWorldHeight + 50;

    const startGx = Math.floor(left / GRID_SIZE);
    const endGx = Math.ceil(right / GRID_SIZE);
    const startGy = Math.floor(top / GRID_SIZE);
    const endGy = Math.ceil(bottom / GRID_SIZE);

    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(left, top, right - left, bottom - top);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let gx = startGx; gx <= endGx; gx++) {
      const x = gx * GRID_SIZE;
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }
    for (let gy = startGy; gy <= endGy; gy++) {
      const y = gy * GRID_SIZE;
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }
    ctx.stroke();
  }
}
