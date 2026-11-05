import { WORKER_TASK_PRIORITY } from './workerProtocol';
import type { WorkerTaskPriority, WorkerTaskRequest, WorkerTaskResponse } from './workerProtocol';
import { recordPerformanceSample } from '../performance/PerformanceDiagnostics';

type TaskWorkerFactory = () => Worker;

interface TaskTypeRegistration {
  factory: TaskWorkerFactory;
  maxWorkers: number;
  failed: boolean;
  failureReason?: string;
}

interface WorkerSlot {
  type: string;
  worker: Worker;
  busy: boolean;
  currentJobId: number | null;
}

interface QueuedJob<TPayload = unknown, TResult = unknown> {
  id: number;
  type: string;
  payload: TPayload;
  priority: WorkerTaskPriority;
  sequence: number;
  queuedAtMs: number;
  resolve: (value: TResult) => void;
  reject: (reason: Error) => void;
}

interface PendingJob {
  type: string;
  slot: WorkerSlot;
  timeoutHandle: ReturnType<typeof setTimeout>;
  queuedAtMs: number;
  startedAtMs: number;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export interface WorkerSchedulerStats {
  queued: number;
  inFlight: number;
  workers: number;
  failedTaskTypes: string[];
}

/**
 * Generic browser-worker task scheduler.
 *
 * - Workers are created lazily per task type and capped to a configured pool size.
 * - Critical tasks are dispatched before normal, then background tasks.
 * - Results return asynchronously; callers must never await them in the simulation tick.
 * - The Worker API being unavailable is represented by `null` for deliberate non-browser/test callers.
 * - Each in-flight task has a deadline. A timed-out or crashed worker slot is retired, its
 *   task is rejected visibly, and a replacement slot may be created for later work.
 * - Invalid worker protocol responses still fail the task type instead of being silently retried.
 * - Payloads/results must be structured-cloneable and workers must echo id/type.
 */
export class WorkerTaskScheduler {
  constructor(private readonly taskTimeoutMs = 5_000) {
    if (!Number.isFinite(taskTimeoutMs) || taskTimeoutMs < 1) {
      throw new RangeError('Worker task timeout must be a positive finite number of milliseconds.');
    }
  }

  private readonly registrations = new Map<string, TaskTypeRegistration>();
  private readonly slots: WorkerSlot[] = [];
  private readonly queue: Array<QueuedJob> = [];
  private readonly pending = new Map<number, PendingJob>();
  private nextId = 1;
  private sequence = 1;
  private disposed = false;

  registerTaskType(type: string, factory: TaskWorkerFactory, maxWorkers = 1): void {
    if (!type.trim()) throw new Error('Worker task type must not be empty');
    if (!Number.isInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 8) {
      throw new RangeError('Worker pool size must be an integer from 1 to 8');
    }
    if (this.registrations.has(type)) throw new Error(`Worker task type already registered: ${type}`);
    this.registrations.set(type, { factory, maxWorkers, failed: false });
  }

  submit<TPayload, TResult>(
    type: string,
    payload: TPayload,
    priority: WorkerTaskPriority = 'normal'
  ): Promise<TResult> | null {
    if (this.disposed) throw new Error('Worker task scheduler has been disposed.');
    if (typeof Worker === 'undefined') return null;
    if (!Object.prototype.hasOwnProperty.call(WORKER_TASK_PRIORITY, priority)) throw new Error(`Unknown worker task priority: '${priority}'.`);
    const registration = this.registrations.get(type);
    if (!registration) throw new Error(`Worker task type is not registered: ${type}`);
    if (registration.failed) throw new Error(`Worker task type '${type}' previously failed: ${registration.failureReason || 'unknown error'}`);

    // Clone before allocating/enqueuing a job. This synchronously rejects non-cloneable
    // payloads before a promise or busy worker slot can be left stranded by postMessage.
    if (typeof structuredClone !== 'function') throw new Error('WorkerTaskScheduler requires structuredClone when Worker is available.');
    const cloneablePayload = structuredClone(payload);

    // Create the first slot before allocating/enqueuing a job. If a Worker constructor
    // throws, the caller sees the exception directly and no unreachable promise is left queued.
    const typeSlots = this.slots.filter(slot => slot.type === type);
    if (!typeSlots.some(slot => !slot.busy) && typeSlots.length < registration.maxWorkers) this.createSlot(type);

    const id = this.nextId++;
    const promise = new Promise<TResult>((resolve, reject) => {
      this.queue.push({ id, type, payload: cloneablePayload, priority, sequence: this.sequence++, queuedAtMs: performance.now(), resolve, reject } as QueuedJob);
    });
    this.pump();
    return promise;
  }

  getStats(): WorkerSchedulerStats {
    return {
      queued: this.queue.length,
      inFlight: this.pending.size,
      workers: this.slots.length,
      failedTaskTypes: [...this.registrations.entries()].filter(([, value]) => value.failed).map(([key]) => key)
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const slot of this.slots) slot.worker.terminate();
    this.slots.length = 0;
    const error = new Error('Worker task scheduler disposed');
    for (const job of this.pending.values()) {
      clearTimeout(job.timeoutHandle);
      job.reject(error);
    }
    this.pending.clear();
    for (const job of this.queue) job.reject(error);
    this.queue.length = 0;
  }

  private createSlot(type: string): WorkerSlot | null {
    const registration = this.registrations.get(type);
    if (!registration || registration.failed || this.disposed) return null;
    const sameTypeSlots = this.slots.filter(slot => slot.type === type);
    if (sameTypeSlots.length >= registration.maxWorkers) return null;
    const worker = registration.factory();
    if (!worker || typeof worker.postMessage !== 'function' || typeof worker.terminate !== 'function') {
      throw new TypeError(`Worker factory for task type '${type}' did not return a valid Worker instance.`);
    }
    const slot: WorkerSlot = { type, worker, busy: false, currentJobId: null };
    worker.onmessage = (event: MessageEvent<WorkerTaskResponse>) => this.onMessage(slot, event.data);
    worker.onerror = (event: ErrorEvent) => this.recycleWorkerSlot(slot, new Error(event.message || `Worker '${type}' failed`));
    worker.onmessageerror = () => this.recycleWorkerSlot(slot, new Error(`Worker '${type}' returned an unreadable message`));
    this.slots.push(slot);
    return slot;
  }

  private onMessage(slot: WorkerSlot, response: WorkerTaskResponse): void {
    if (!response || typeof response !== 'object' || !Number.isSafeInteger(response.id) ||
        typeof response.type !== 'string' || (response.error !== undefined && (typeof response.error !== 'string' || response.error.length === 0)) ||
        (response.error === undefined && !Object.prototype.hasOwnProperty.call(response, 'result'))) {
      this.failTaskType(slot.type, new Error(`Worker '${slot.type}' returned a malformed task response.`));
      return;
    }
    if (slot.type !== response.type || slot.currentJobId !== response.id) {
      this.failTaskType(slot.type, new Error(
        `Worker protocol mismatch: slot '${slot.type}' expected job ${slot.currentJobId}, received '${response.type}' job ${response.id}.`
      ));
      return;
    }
    const job = this.pending.get(response.id);
    if (!job || job.type !== slot.type) {
      this.failTaskType(slot.type, new Error(`Worker response ${response.id} has no matching pending job.`));
      return;
    }

    clearTimeout(job.timeoutHandle);
    const responseAtMs = performance.now();
    recordPerformanceSample('worker.executionAndReturn', responseAtMs - job.startedAtMs, { taskType: job.type, jobId: response.id });
    slot.busy = false;
    slot.currentJobId = null;
    this.pending.delete(response.id);
    if (response.error) {
      const error = new Error(response.error);
      console.error(`[worker] Task '${slot.type}' job ${response.id} failed.`, error);
      job.reject(error);
    } else {
      job.resolve(response.result);
    }
    this.pump();
  }

  /**
   * Retire one failed/timed-out worker without poisoning its whole task type.
   * The task promise is rejected so owners can reset their pending state and retry;
   * queued or future work can use a newly-created worker slot.
   */
  private recycleWorkerSlot(slot: WorkerSlot, error: Error): void {
    const slotIndex = this.slots.indexOf(slot);
    if (slotIndex < 0) return;
    this.slots.splice(slotIndex, 1);
    try {
      slot.worker.terminate();
    } catch (terminateError) {
      console.error(`[worker] Failed to terminate retired '${slot.type}' worker.`, terminateError);
    }

    const jobId = slot.currentJobId;
    slot.busy = false;
    slot.currentJobId = null;
    if (jobId !== null) {
      const job = this.pending.get(jobId);
      if (job && job.slot === slot) {
        clearTimeout(job.timeoutHandle);
        this.pending.delete(jobId);
        recordPerformanceSample('worker.failedExecution', performance.now() - job.startedAtMs, { taskType: job.type, jobId, reason: error.message });
        job.reject(error);
      }
    }
    console.error(`[worker] Retired '${slot.type}' worker slot; the failed task was rejected and later work may retry.`, error);
    this.pump();
  }

  private failTaskType(type: string, error: Error): void {
    console.error(`[worker] Task type '${type}' failed.`, error);
    const registration = this.registrations.get(type);
    if (registration) {
      registration.failed = true;
      registration.failureReason = error.message;
    }
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const slot = this.slots[i];
      if (slot.type !== type) continue;
      slot.worker.terminate();
      this.slots.splice(i, 1);
    }
    for (const [id, job] of this.pending) {
      if (job.type !== type) continue;
      clearTimeout(job.timeoutHandle);
      this.pending.delete(id);
      job.reject(error);
    }
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].type !== type) continue;
      this.queue[i].reject(error);
      this.queue.splice(i, 1);
    }
    this.pump();
  }

  private pump(): void {
    if (this.disposed || typeof Worker === 'undefined') return;
    this.queue.sort((a, b) => WORKER_TASK_PRIORITY[a.priority] - WORKER_TASK_PRIORITY[b.priority] || a.sequence - b.sequence);
    let dispatched = true;
    while (dispatched) {
      dispatched = false;
      for (let index = 0; index < this.queue.length; index++) {
        const job = this.queue[index];
        const registration = this.registrations.get(job.type);
        if (!registration || registration.failed) {
          this.queue.splice(index--, 1);
          const error = new Error(registration?.failureReason || `Worker task type unavailable: ${job.type}`);
          console.error(`[worker] Rejecting queued task ${job.id} because task type '${job.type}' is unavailable.`, error);
          job.reject(error);
          continue;
        }
        let slot = this.slots.find(candidate => candidate.type === job.type && !candidate.busy);
        if (!slot) slot = this.createSlot(job.type) || undefined;
        if (!slot || slot.busy) {
          if (registration.failed) {
            this.queue.splice(index--, 1);
            job.reject(new Error(registration.failureReason || `Worker task type unavailable: ${job.type}`));
            dispatched = true;
            break;
          }
          continue;
        }

        this.queue.splice(index, 1);
        slot.busy = true;
        slot.currentJobId = job.id;
        const timeoutHandle = setTimeout(() => {
          this.recycleWorkerSlot(
            slot!,
            new Error(`Worker task '${job.type}' job ${job.id} exceeded its ${this.taskTimeoutMs} ms deadline.`)
          );
        }, this.taskTimeoutMs);
        const startedAtMs = performance.now();
        recordPerformanceSample('worker.queueWait', startedAtMs - job.queuedAtMs, { taskType: job.type, jobId: job.id });
        this.pending.set(job.id, { type: job.type, slot, timeoutHandle, queuedAtMs: job.queuedAtMs, startedAtMs, resolve: job.resolve, reject: job.reject });
        const request: WorkerTaskRequest = { id: job.id, type: job.type, payload: job.payload };
        try {
          slot.worker.postMessage(request);
        } catch (error) {
          this.recycleWorkerSlot(slot, error instanceof Error ? error : new Error(String(error)));
        }
        dispatched = true;
        break;
      }
    }
  }
}
