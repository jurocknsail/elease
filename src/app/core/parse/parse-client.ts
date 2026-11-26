import { Injectable } from '@angular/core';
import Parse from 'parse';
import { environment } from '../../../environments/environment';
import { assertRecipientAllowed, effectiveSandbox } from '../email/email-guard';

/** Parse error code for an expired or invalid session token. */
export const INVALID_SESSION_TOKEN = 209;
/** The Cloud Code function that sends the rent calls by e-mail. */
const SEND_EMAIL_FUNCTION = 'sendEmail';
/** Parse error code for "object not found". */
export const OBJECT_NOT_FOUND = 101;

/** Raised when a write needs the signed-in user but there is none. Same code as an expired session. */
export class NoSessionError extends Error {
  readonly code = INVALID_SESSION_TOKEN;

  constructor() {
    super('Session expirée : veuillez vous reconnecter.');
    this.name = 'NoSessionError';
  }
}

/**
 * The small slice of the Parse SDK the repositories use. Real `Parse.Object`, `Parse.Query` and
 * `Parse.ACL` instances satisfy these shapes; specs provide an in-memory fake, so no test touches the
 * SDK or the network.
 */
export interface RemoteAcl {
  toJSON(): unknown;
}

export interface RemoteObject {
  readonly id: string | undefined;
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  /** Removes the field on the server at the next save. */
  unset(key: string): unknown;
  /** Atomic server-side "append unless already present". */
  addUnique(key: string, value: unknown): unknown;
  /** Atomic server-side removal of every occurrence. */
  remove(key: string, value: unknown): unknown;
  setACL(acl: RemoteAcl): unknown;
  save(): Promise<RemoteObject>;
  destroy(): Promise<RemoteObject>;
  toJSON(): Record<string, unknown>;
}

export interface RemoteQuery {
  include(key: string): RemoteQuery;
  ascending(key: string): RemoteQuery;
  limit(count: number): RemoteQuery;
  equalTo(key: string, value: unknown): RemoteQuery;
  find(): Promise<RemoteObject[]>;
  first(): Promise<RemoteObject | undefined>;
}

/**
 * Gateway to the Parse SDK (Back4App). Repositories inject this class; specs replace it with a fake.
 * Calls made through it return raw promises: the repositories wrap each one in `withTimeout`, and let
 * Parse errors propagate unchanged.
 */
@Injectable({ providedIn: 'root', useFactory: () => new SdkParseClient() })
export abstract class ParseClient {
  /** A new, unsaved object of the given class. */
  abstract newObject(className: string): RemoteObject;
  /** An unfetched reference (pointer) to an existing object: enough to relate it, update it or destroy it. */
  abstract objectRef(className: string, id: string): RemoteObject;
  abstract query(className: string): RemoteQuery;
  /** Fetches one object by id; rejects with Parse error 101 when it does not exist (or is not readable). */
  abstract fetchById(className: string, id: string): Promise<RemoteObject>;
  /** ACL readable and writable by the signed-in user only; throws `NoSessionError` without a session. */
  abstract ownerAcl(): RemoteAcl;
  abstract currentUser(): RemoteObject | null;
  /** E-mail of the signed-in user (the sender of the rent calls), or null without a session or e-mail. */
  abstract currentUserEmail(): string | null;
  /**
   * Runs a Cloud Code function and gives its result. Returns a raw promise (callers add their own
   * timeout) and lets Parse errors propagate unchanged.
   */
  abstract runCloud(name: string, params: Record<string, unknown>): Promise<unknown>;
}

let sdkInitialized = false;

/** Initializes the SDK on first use, never at import time. Idempotent. */
function ensureSdk(): void {
  if (sdkInitialized) {
    return;
  }
  Parse.initialize(environment.parseAppId, environment.parseJsKey);
  Parse.serverURL = environment.parseServerUrl;
  // The browser build defaults to single-instance mode: all objects with the same id share their
  // pending changes, so the changes of a failed save leak into the next save of an unrelated object
  // with that id (and a failed Remove op blocks the next AddUnique on the same field). Every object
  // here is independent: turn it off before any object exists. @types/parse does not declare it.
  (Parse.Object as unknown as { disableSingleInstance(): void }).disableSingleInstance();
  // The SDK re-sends a request that failed with a 5xx status or a network error, up to 5 attempts,
  // POST included, and keeps going after our timeout stopped waiting. For the `sendEmail` cloud call
  // that means a backend answering 504 after a minute could deliver the same e-mail several times.
  // So: no automatic retry at all. The screens offer « Réessayer » instead.
  (Parse.CoreManager as unknown as { set(key: string, value: unknown): void }).set(
    'REQUEST_ATTEMPT_LIMIT',
    1,
  );
  sdkInitialized = true;
}

class SdkParseClient extends ParseClient {
  override newObject(className: string): RemoteObject {
    ensureSdk();
    return new Parse.Object(className);
  }

  override objectRef(className: string, id: string): RemoteObject {
    ensureSdk();
    const ref = new Parse.Object(className);
    ref.id = id;
    return ref;
  }

  override query(className: string): RemoteQuery {
    ensureSdk();
    return new Parse.Query(className);
  }

  override fetchById(className: string, id: string): Promise<RemoteObject> {
    ensureSdk();
    return new Parse.Query(className).get(id);
  }

  override ownerAcl(): RemoteAcl {
    ensureSdk();
    const user = Parse.User.current();
    if (!user) {
      throw new NoSessionError();
    }
    // Same ACL as the legacy app: only the owner can read or write.
    const acl = new Parse.ACL(user);
    acl.setPublicReadAccess(false);
    acl.setPublicWriteAccess(false);
    return acl;
  }

  override currentUser(): RemoteObject | null {
    ensureSdk();
    return Parse.User.current() ?? null;
  }

  override currentUserEmail(): string | null {
    ensureSdk();
    // Same source as the legacy sender: `Parse.User.current()?.getEmail()`.
    return Parse.User.current()?.getEmail() || null;
  }

  override async runCloud(name: string, params: Record<string, unknown>): Promise<unknown> {
    if (name === SEND_EMAIL_FUNCTION) {
      // Last choke point for e-mail: whoever calls (the sender, a future caller, a test that swapped
      // the injected environment), nothing leaves unless the REAL build environment allows it, and
      // the Mailjet sandbox is forced outside production. The caller's object is not modified.
      assertRecipientAllowed(params['recipientEmail'] as string, environment);
      params = { ...params, sandbox: effectiveSandbox(environment) };
    }
    ensureSdk();
    return Parse.Cloud.run(name, params);
  }
}
