import {
  NoSessionError,
  OBJECT_NOT_FOUND,
  ParseClient,
  RemoteAcl,
  RemoteObject,
  RemoteQuery,
} from '../parse-client';

/**
 * In-memory stand-in for the Parse SDK, used by repository specs: no SDK, no network, no credentials.
 * It models what matters to the repositories: pointers, `include`, atomic array operations applied on
 * the stored record at save time, ACLs, and error / hang injection. Test-only: never import it from
 * application code.
 */

export type FakeOp =
  | { kind: 'set'; key: string; value: unknown }
  | { kind: 'unset'; key: string }
  | { kind: 'addUnique'; key: string; value: unknown }
  | { kind: 'remove'; key: string; value: unknown };

/** What a query asked for, as the repositories built it. */
export interface FakeQueryParams {
  include: string[];
  /** Ascending sort key. */
  order?: string;
  limit?: number;
  /** `equalTo` constraints, pointers in their JSON form. */
  where: Array<[string, unknown]>;
}

export interface FakeCall {
  op: 'find' | 'fetch' | 'save' | 'destroy' | 'cloud';
  /** Class of the object concerned; empty for a cloud function. */
  className: string;
  id?: string;
  /** Name of the cloud function (`cloud` calls). */
  functionName?: string;
  /** A copy of the parameters of a cloud function. */
  params?: Record<string, unknown>;
  /** Parameters of a `find`. */
  query?: FakeQueryParams;
  /** Field operations carried by a save. */
  ops?: readonly FakeOp[];
  /** ACL set on the object before a save. */
  acl?: unknown;
}

interface StoredRecord {
  className: string;
  id: string;
  attrs: Record<string, unknown>;
  acl?: unknown;
  createdAt: number;
  updatedAt: number;
}

interface Failure {
  match: (call: FakeCall) => boolean;
  error: unknown;
  hang: boolean;
  once: boolean;
}

interface PointerJson {
  __type: 'Pointer';
  className: string;
  objectId: string;
}

export function pointer(className: string, objectId: string): PointerJson {
  return { __type: 'Pointer', className, objectId };
}

function isPointer(value: unknown): value is PointerJson {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __type?: unknown }).__type === 'Pointer'
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Error shaped like a Parse.Error. */
export function parseError(
  code: number,
  message = `Parse error ${code}`,
): Error & { code: number } {
  return Object.assign(new Error(message), { code });
}

const EPOCH = Date.UTC(2026, 0, 1);

export class FakeParseClient implements ParseClient {
  /** Every remote operation, in order. */
  readonly calls: FakeCall[] = [];
  /** Signed-in user id; null simulates a missing session. */
  userId: string | null = 'user-1';
  /** E-mail of the signed-in user. */
  userEmail: string | null = 'proprietaire@example.test';
  /** What a cloud function resolves with. */
  cloudResult: unknown = undefined;

  private readonly records = new Map<string, StoredRecord>();
  private readonly failures: Failure[] = [];
  private counter = 0;

  // ----- test helpers -----

  /**
   * Puts a record in the fake server. `attrs` use the Parse JSON encoding (pointers via `pointer()`).
   * `createdAt` (a logical tick) defaults to "now", i.e. after every record seeded before.
   */
  seed(
    className: string,
    id: string,
    attrs: Record<string, unknown> = {},
    options: { createdAt?: number } = {},
  ): void {
    const tick = this.tick();
    this.records.set(`${className}:${id}`, {
      className,
      id,
      attrs: clone(attrs),
      acl: this.userId ? { [this.userId]: { read: true, write: true } } : undefined,
      createdAt: options.createdAt ?? tick,
      updatedAt: tick,
    });
  }

  record(className: string, id: string): StoredRecord | undefined {
    return this.records.get(`${className}:${id}`);
  }

  recordsOf(className: string): StoredRecord[] {
    return [...this.records.values()].filter((r) => r.className === className);
  }

  /** Makes the next matching operation reject with `error`. */
  failWhen(match: (call: FakeCall) => boolean, error: unknown, once = true): void {
    this.failures.push({ match, error, hang: false, once });
  }

  /** Makes the next matching operation never settle (Back4App hanging). */
  hangWhen(match: (call: FakeCall) => boolean, once = true): void {
    this.failures.push({ match, error: undefined, hang: true, once });
  }

  callsOf(op: FakeCall['op'], className?: string): FakeCall[] {
    return this.calls.filter(
      (c) => c.op === op && (className === undefined || c.className === className),
    );
  }

  // ----- ParseClient -----

  newObject(className: string): RemoteObject {
    return new FakeObject(this, className, undefined, true);
  }

  objectRef(className: string, id: string): RemoteObject {
    return new FakeObject(this, className, id, false);
  }

  query(className: string): RemoteQuery {
    return new FakeQuery(this, className);
  }

  async fetchById(className: string, id: string): Promise<RemoteObject> {
    await this.gate({ op: 'fetch', className, id });
    const record = this.record(className, id);
    if (!record) {
      throw parseError(OBJECT_NOT_FOUND, 'Object not found.');
    }
    return new FakeObject(this, className, id, true);
  }

  ownerAcl(): RemoteAcl {
    const owner = this.userId;
    if (!owner) {
      throw new NoSessionError();
    }
    return { toJSON: () => ({ [owner]: { read: true, write: true } }) };
  }

  currentUser(): RemoteObject | null {
    return this.userId ? new FakeObject(this, '_User', this.userId, true) : null;
  }

  currentUserEmail(): string | null {
    return this.userId ? this.userEmail : null;
  }

  async runCloud(name: string, params: Record<string, unknown>): Promise<unknown> {
    await this.gate({ op: 'cloud', className: '', functionName: name, params: clone(params) });
    return clone(this.cloudResult);
  }

  // ----- internals shared with FakeObject / FakeQuery -----

  /** Records a call and applies failure injection. Resolves when the call may proceed. */
  async gate(call: FakeCall): Promise<void> {
    this.calls.push(call);
    const index = this.failures.findIndex((f) => f.match(call));
    if (index === -1) {
      return;
    }
    const failure = this.failures[index];
    if (failure.once) {
      this.failures.splice(index, 1);
    }
    if (failure.hang) {
      await new Promise<never>(() => undefined);
    }
    throw failure.error;
  }

  nextId(className: string): string {
    this.counter += 1;
    return `${className.toLowerCase()}${this.counter}`;
  }

  tick(): number {
    this.counter += 1;
    return this.counter;
  }

  store(record: StoredRecord): void {
    this.records.set(`${record.className}:${record.id}`, record);
  }

  remove(className: string, id: string): boolean {
    return this.records.delete(`${className}:${id}`);
  }

  iso(tick: number): string {
    return new Date(EPOCH + tick * 1000).toISOString();
  }
}

class FakeObject implements RemoteObject {
  id: string | undefined;
  private view: Record<string, unknown> = {};
  private ops: FakeOp[] = [];
  private acl: unknown;
  /** Keys whose pointers resolve to full objects (`include`). */
  private readonly included = new Set<string>();

  constructor(
    private readonly client: FakeParseClient,
    readonly className: string,
    id: string | undefined,
    fetched: boolean,
  ) {
    this.id = id;
    if (id !== undefined && fetched) {
      this.refresh();
    }
  }

  markIncluded(keys: readonly string[]): void {
    keys.forEach((key) => this.included.add(key));
  }

  get(key: string): unknown {
    return this.decode(this.view[key], key);
  }

  set(key: string, value: unknown): this {
    const encoded = this.encode(value);
    this.ops.push({ kind: 'set', key, value: encoded });
    this.view[key] = clone(encoded);
    return this;
  }

  unset(key: string): this {
    this.ops.push({ kind: 'unset', key });
    delete this.view[key];
    return this;
  }

  addUnique(key: string, value: unknown): this {
    const encoded = this.encode(value);
    this.ops.push({ kind: 'addUnique', key, value: encoded });
    this.view[key] = applyAddUnique(this.view[key], encoded);
    return this;
  }

  remove(key: string, value: unknown): this {
    const encoded = this.encode(value);
    this.ops.push({ kind: 'remove', key, value: encoded });
    this.view[key] = applyRemove(this.view[key], encoded);
    return this;
  }

  setACL(acl: RemoteAcl): this {
    this.acl = acl.toJSON();
    return this;
  }

  async save(): Promise<RemoteObject> {
    const ops = [...this.ops];
    await this.client.gate({
      op: 'save',
      className: this.className,
      id: this.id,
      ops,
      acl: this.acl,
    });
    const tick = this.client.tick();
    let record = this.id === undefined ? undefined : this.client.record(this.className, this.id);
    if (this.id === undefined) {
      this.id = this.client.nextId(this.className);
      record = {
        className: this.className,
        id: this.id,
        attrs: {},
        createdAt: tick,
        updatedAt: tick,
      };
      this.client.store(record);
    } else if (!record) {
      throw parseError(OBJECT_NOT_FOUND, 'Object not found.');
    }
    for (const op of ops) {
      applyOp(record.attrs, op);
    }
    if (this.acl !== undefined) {
      record.acl = clone(this.acl);
    }
    record.updatedAt = tick;
    this.ops = [];
    this.refresh();
    return this;
  }

  async destroy(): Promise<RemoteObject> {
    await this.client.gate({ op: 'destroy', className: this.className, id: this.id });
    if (this.id === undefined || !this.client.remove(this.className, this.id)) {
      throw parseError(OBJECT_NOT_FOUND, 'Object not found.');
    }
    return this;
  }

  toJSON(): Record<string, unknown> {
    const record = this.id === undefined ? undefined : this.client.record(this.className, this.id);
    const out: Record<string, unknown> = {};
    if (this.id !== undefined) {
      out['objectId'] = this.id;
    }
    if (record) {
      out['createdAt'] = this.client.iso(record.createdAt);
      out['updatedAt'] = this.client.iso(record.updatedAt);
    }
    for (const [key, value] of Object.entries(this.view)) {
      out[key] = this.toJsonValue(value, key);
    }
    if (record?.acl !== undefined) {
      out['ACL'] = clone(record.acl);
    }
    return out;
  }

  /** Reloads the local view from the stored record (what a fetch or a save response would give). */
  private refresh(): void {
    const record = this.id === undefined ? undefined : this.client.record(this.className, this.id);
    this.view = record ? clone(record.attrs) : {};
  }

  private encode(value: unknown): unknown {
    if (value instanceof FakeObject) {
      if (value.id === undefined) {
        throw new Error('Cannot reference an unsaved object.');
      }
      return pointer(value.className, value.id);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.encode(item));
    }
    return clone(value);
  }

  private decode(value: unknown, key: string): unknown {
    if (isPointer(value)) {
      const resolved =
        this.included.has(key) && !!this.client.record(value.className, value.objectId);
      return new FakeObject(this.client, value.className, value.objectId, resolved);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.decode(item, key));
    }
    return clone(value);
  }

  private toJsonValue(value: unknown, key: string): unknown {
    if (isPointer(value)) {
      const target = this.included.has(key)
        ? this.client.record(value.className, value.objectId)
        : undefined;
      if (!target) {
        return clone(value);
      }
      return {
        __type: 'Object',
        className: target.className,
        objectId: target.id,
        createdAt: this.client.iso(target.createdAt),
        updatedAt: this.client.iso(target.updatedAt),
        ...clone(target.attrs),
        ...(target.acl !== undefined ? { ACL: clone(target.acl) } : {}),
      };
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.toJsonValue(item, key));
    }
    return clone(value);
  }
}

function samePointer(a: unknown, b: unknown): boolean {
  return isPointer(a) && isPointer(b) && a.className === b.className && a.objectId === b.objectId;
}

function applyAddUnique(current: unknown, value: unknown): unknown[] {
  const list = Array.isArray(current) ? [...current] : [];
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    if (!list.some((existing) => samePointer(existing, item))) {
      list.push(clone(item));
    }
  }
  return list;
}

function applyRemove(current: unknown, value: unknown): unknown[] {
  const list = Array.isArray(current) ? current : [];
  const items = Array.isArray(value) ? value : [value];
  return list.filter((existing) => !items.some((item) => samePointer(existing, item)));
}

function applyOp(attrs: Record<string, unknown>, op: FakeOp): void {
  switch (op.kind) {
    case 'set':
      attrs[op.key] = clone(op.value);
      break;
    case 'unset':
      delete attrs[op.key];
      break;
    case 'addUnique':
      attrs[op.key] = applyAddUnique(attrs[op.key], op.value);
      break;
    case 'remove':
      attrs[op.key] = applyRemove(attrs[op.key], op.value);
      break;
  }
}

class FakeQuery implements RemoteQuery {
  private readonly includes: string[] = [];
  private readonly constraints: Array<[string, unknown]> = [];
  private sortKey: string | undefined;
  private max = Number.POSITIVE_INFINITY;

  constructor(
    private readonly client: FakeParseClient,
    private readonly className: string,
  ) {}

  include(key: string): this {
    this.includes.push(key);
    return this;
  }

  ascending(key: string): this {
    this.sortKey = key;
    return this;
  }

  limit(count: number): this {
    this.max = count;
    return this;
  }

  equalTo(key: string, value: unknown): this {
    this.constraints.push([
      key,
      value instanceof FakeObject ? pointer(value.className, value.id ?? '') : value,
    ]);
    return this;
  }

  async find(): Promise<RemoteObject[]> {
    await this.client.gate({
      op: 'find',
      className: this.className,
      query: {
        include: [...this.includes],
        order: this.sortKey,
        limit: Number.isFinite(this.max) ? this.max : undefined,
        where: this.constraints.map(([key, value]) => [key, clone(value)]),
      },
    });
    let records = this.client
      .recordsOf(this.className)
      .filter((record) =>
        this.constraints.every(
          ([key, expected]) => JSON.stringify(record.attrs[key]) === JSON.stringify(expected),
        ),
      );
    if (this.sortKey === 'createdAt') {
      records = [...records].sort((a, b) => a.createdAt - b.createdAt);
    }
    return records.slice(0, this.max).map((record) => {
      const object = new FakeObject(this.client, record.className, record.id, true);
      object.markIncluded(this.includes);
      return object;
    });
  }

  async first(): Promise<RemoteObject | undefined> {
    this.max = 1;
    return (await this.find())[0];
  }
}
