/**
 * JSON-safe, identity-aware state deltas for authoritative multiplayer replication.
 *
 * Deltas are always relative to an exact base revision. If a client cannot apply a
 * delta to that base, it must request a full state; it must never guess or patch up
 * a mismatched replica. Entity arrays use stable IDs so removing one item does not
 * require retransmitting every item after it.
 */
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonPath = Array<string | number>;
export type JsonObject = { [key: string]: JsonValue };

export type StatePatchOperation =
  | { op: 'set'; path: JsonPath; value: JsonValue }
  | { op: 'delete'; path: JsonPath }
  | {
      op: 'collection';
      path: JsonPath;
      keyField: string;
      removed: string[];
      /** Newly added records carry their final collection index, avoiding a full ID list for appends. */
      added: Array<{ index: number; value: JsonObject }>;
      updated: Array<{ key: string; patch: StatePatchOperation[] }>;
      /** Included only when pre-existing records are reordered. */
      order?: string[];
    };

const STABLE_KEY_FIELDS = ['id', 'playerId'] as const;


function afterOrderFor(after: unknown[], keyField: string): Array<{ key: string; index: number; value: Record<string, unknown> }> {
  return after.map((value, index) => {
    if (!isPlainObject(value) || typeof value[keyField] !== 'string') {
      throw new TypeError(`Stable-key collection record is missing key field '${keyField}'.`);
    }
    return { key: value[keyField] as string, index, value };
  });
}

/** Clone only JSON-compatible data; wire state is intentionally JSON, not arbitrary JS objects. */
export function cloneWireValue<T>(value: T): T {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('Multiplayer state cannot be serialized to JSON.');
  return JSON.parse(encoded) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index++) if (!valuesEqual(a[index], b[index])) return false;
    return true;
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key) || !valuesEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function selectStableKeyField(before: unknown[], after: unknown[]): string | null {
  if (before.length === 0 && after.length === 0) return null;
  for (const candidate of STABLE_KEY_FIELDS) {
    let valid = true;
    for (const values of [before, after]) {
      const keys: string[] = [];
      for (const item of values) {
        if (!isPlainObject(item) || typeof item[candidate] !== 'string' || item[candidate].length === 0) {
          valid = false;
          break;
        }
        keys.push(item[candidate] as string);
      }
      if (!valid || new Set(keys).size !== keys.length) {
        valid = false;
        break;
      }
    }
    if (valid) return candidate;
  }
  return null;
}

function diffValues(before: unknown, after: unknown, path: JsonPath, operations: StatePatchOperation[]): void {
  if (valuesEqual(before, after)) return;

  if (isPlainObject(before) && isPlainObject(after)) {
    for (const key of Object.keys(before)) {
      if (!Object.prototype.hasOwnProperty.call(after, key)) operations.push({ op: 'delete', path: [...path, key] });
    }
    for (const key of Object.keys(after)) {
      if (!Object.prototype.hasOwnProperty.call(before, key)) {
        operations.push({ op: 'set', path: [...path, key], value: cloneWireValue(after[key]) as JsonValue });
      } else {
        diffValues(before[key], after[key], [...path, key], operations);
      }
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const keyField = selectStableKeyField(before, after);
    if (keyField) {
      const beforeByKey = new Map<string, Record<string, unknown>>();
      const afterByKey = new Map<string, Record<string, unknown>>();
      for (const item of before) beforeByKey.set((item as Record<string, unknown>)[keyField] as string, item as Record<string, unknown>);
      for (const item of after) afterByKey.set((item as Record<string, unknown>)[keyField] as string, item as Record<string, unknown>);
      const removed = [...beforeByKey.keys()].filter(key => !afterByKey.has(key));
      const beforeKeySet = new Set(beforeByKey.keys());
      const afterKeySet = new Set(afterByKey.keys());
      const added = afterOrderFor(after, keyField)
        .filter(item => !beforeKeySet.has(item.key))
        .map(item => ({ index: item.index, value: cloneWireValue(item.value) as JsonObject }));
      const updated: Array<{ key: string; patch: StatePatchOperation[] }> = [];
      for (const [key, current] of afterByKey) {
        const prior = beforeByKey.get(key);
        if (!prior) continue;
        const patch: StatePatchOperation[] = [];
        diffValues(prior, current, [], patch);
        if (patch.length > 0) updated.push({ key, patch });
      }
      const beforeOrder = before.map(item => (item as Record<string, unknown>)[keyField] as string);
      const afterOrder = after.map(item => (item as Record<string, unknown>)[keyField] as string);
      const survivingBeforeOrder = beforeOrder.filter(key => afterKeySet.has(key));
      const survivingAfterOrder = afterOrder.filter(key => beforeKeySet.has(key));
      const existingRecordsReordered = survivingBeforeOrder.length !== survivingAfterOrder.length ||
        survivingBeforeOrder.some((key, index) => key !== survivingAfterOrder[index]);
      const orderChanged = beforeOrder.length !== afterOrder.length || beforeOrder.some((key, index) => key !== afterOrder[index]);
      if (removed.length || added.length || updated.length || orderChanged) {
        operations.push({
          op: 'collection', path, keyField, removed, added, updated,
          ...(existingRecordsReordered ? { order: afterOrder } : {})
        });
      }
      return;
    }
  }

  if (path.length === 0) throw new Error('A root replacement cannot be represented as a state delta.');
  operations.push({ op: 'set', path, value: cloneWireValue(after) as JsonValue });
}

/** Produce a compact patch between two serializable snapshots. */
export function diffState(before: unknown, after: unknown): StatePatchOperation[] {
  const operations: StatePatchOperation[] = [];
  diffValues(before, after, [], operations);
  return operations;
}

function getParent(root: unknown, path: JsonPath): { parent: Record<string, unknown> | unknown[]; key: string | number } {
  if (path.length === 0) throw new Error('State patch operation cannot target the document root.');
  let current: unknown = root;
  for (const segment of path.slice(0, -1)) {
    if (Array.isArray(current) && typeof segment === 'number') current = current[segment];
    else if (isPlainObject(current) && typeof segment === 'string') current = current[segment];
    else throw new TypeError(`State patch path is invalid at '${String(segment)}'.`);
  }
  const key = path[path.length - 1];
  if (Array.isArray(current) && typeof key === 'number') return { parent: current, key };
  if (isPlainObject(current) && typeof key === 'string') return { parent: current, key };
  throw new TypeError(`State patch parent does not exist for '${String(key)}'.`);
}

function applyOperationsToMutableRoot(root: unknown, operations: StatePatchOperation[]): unknown {
  for (const operation of operations) {
    if (operation.op === 'set') {
      const { parent, key } = getParent(root, operation.path);
      if (Array.isArray(parent) && typeof key === 'number') parent[key] = cloneWireValue(operation.value);
      else if (isPlainObject(parent) && typeof key === 'string') parent[key] = cloneWireValue(operation.value);
      else throw new TypeError('State patch set operation has an invalid target.');
      continue;
    }
    if (operation.op === 'delete') {
      const { parent, key } = getParent(root, operation.path);
      if (Array.isArray(parent) && typeof key === 'number') parent.splice(key, 1);
      else if (isPlainObject(parent) && typeof key === 'string') delete parent[key];
      else throw new TypeError('State patch delete operation has an invalid target.');
      continue;
    }

    let target: unknown = root;
    for (const segment of operation.path) {
      if (Array.isArray(target) && typeof segment === 'number') target = target[segment];
      else if (isPlainObject(target) && typeof segment === 'string') target = target[segment];
      else throw new TypeError(`State collection path is invalid at '${String(segment)}'.`);
    }
    if (!Array.isArray(target)) throw new TypeError('State collection operation target is not an array.');
    const collection = target as Array<Record<string, unknown>>;
    const byKey = new Map<string, Record<string, unknown>>();
    for (const item of collection) {
      const key = item[operation.keyField];
      if (typeof key !== 'string') throw new TypeError(`State collection record is missing key field '${operation.keyField}'.`);
      if (byKey.has(key)) throw new Error(`State collection contains duplicate key '${key}'.`);
      byKey.set(key, item);
    }
    for (const key of operation.removed) {
      if (!byKey.delete(key)) throw new Error(`State delta attempted to remove missing collection key '${key}'.`);
    }
    const existingOrder = collection
      .map(item => item[operation.keyField])
      .filter((key): key is string => typeof key === 'string' && !operation.removed.includes(key));
    const additions = [...operation.added].sort((a, b) => a.index - b.index);
    for (const addition of additions) {
      const key = addition.value[operation.keyField];
      if (typeof key !== 'string' || byKey.has(key)) throw new Error(`State delta attempted to add an invalid or duplicate collection key '${String(key)}'.`);
      if (!Number.isSafeInteger(addition.index) || addition.index < 0 || addition.index > existingOrder.length + additions.indexOf(addition)) {
        throw new Error(`State delta contains an invalid insertion index '${addition.index}'.`);
      }
      byKey.set(key, cloneWireValue(addition.value));
    }
    for (const update of operation.updated) {
      const item = byKey.get(update.key);
      if (!item) throw new Error(`State delta attempted to update missing collection key '${update.key}'.`);
      applyOperationsToMutableRoot(item, update.patch);
    }
    let order: string[];
    if (operation.order) {
      order = operation.order;
    } else {
      order = existingOrder;
      for (const addition of additions) order.splice(addition.index, 0, addition.value[operation.keyField] as string);
    }
    if (order.length !== byKey.size || new Set(order).size !== order.length || order.some(key => !byKey.has(key))) {
      throw new Error('State delta contains an invalid collection ordering.');
    }
    collection.splice(0, collection.length, ...order.map(key => byKey.get(key)!));
  }
  return root;
}

/** Apply a delta immutably; malformed operations throw and must trigger an explicit resync. */
export function applyStateDelta<T>(base: T, operations: StatePatchOperation[]): T {
  return applyOperationsToMutableRoot(cloneWireValue(base), operations) as T;
}
