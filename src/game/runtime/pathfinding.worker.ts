import type { PathWaypoint } from '../types';
import { findPath } from '../pathfinding';
import type { PathfindingWorkerPayload } from './asyncPathfinding';
import type { WorkerTaskRequest, WorkerTaskResponse } from './workerProtocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerTaskRequest<PathfindingWorkerPayload>>) => void) | null;
  postMessage(message: WorkerTaskResponse<PathWaypoint[]>): void;
}

const scope = self as unknown as WorkerScope;
scope.onmessage = (event) => {
  const request = event.data;
  if (request.type !== 'pathfinding') return;
  const payload = request.payload;
  const path = findPath(
    payload.startX, payload.startY, payload.targetX, payload.targetY,
    payload.isFlying, payload.buildings, payload.resources
  );
  scope.postMessage({ id: request.id, type: request.type, result: path });
};
