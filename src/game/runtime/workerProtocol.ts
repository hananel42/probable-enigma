/** Serializable envelope shared by the main-thread scheduler and module workers. */
export interface WorkerTaskRequest<TPayload = unknown> {
  id: number;
  type: string;
  payload: TPayload;
}

export interface WorkerTaskResponse<TResult = unknown> {
  id: number;
  type: string;
  result?: TResult;
  error?: string;
}

export type WorkerTaskPriority = 'critical' | 'normal' | 'background';

export const WORKER_TASK_PRIORITY: Record<WorkerTaskPriority, number> = {
  critical: 0,
  normal: 1,
  background: 2
};
