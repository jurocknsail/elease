import { isSessionError } from '../../core/auth/session-error';
import { INDEX_TYPES, IndexType, Lease } from '../../core/models/lease';
import { Leaseholder } from '../../core/models/leaseholder';
import type { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import { BackendTimeoutError } from '../../core/parse/with-timeout';

/*
 * Backup and restore of the tenants and their leases (« Réglages > Sauvegarde »).
 *
 * The file is the legacy export: a JSON array of holders, each with its `leases` array. The legacy file
 * was `JSON.stringify` of the Parse objects (so it also carried objectId, createdAt, updatedAt, ACL,
 * isSelected, indexing...); the new export keeps the same layout with the fields the app uses. Reading
 * accepts both and ignores the rest: `isSelected` and `indexing` are never read nor written.
 *
 * Restoring only ever ADDS. Everything it creates belongs to the current user (the repositories set the
 * owner-only ACL), whatever the file says. The ids of the file are used for one thing only: telling what
 * is « already present ». Nothing is updated and nothing is deleted.
 */

/** A real backup is a few kB (7 holders, 9 leases): anything above this is not one. */
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_HOLDERS = 1000;
const MAX_LEASES = 5000;
const MAX_TEXT = 500;

/** The file cannot be used; the message is French and meant for the user. Nothing was created. */
export class BackupFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFileError';
  }
}

// ---------------------------------------------------------------------------------------------
// Export

/** `elease-backup-<username>-<YYYY-MM-DD>.json`, local date; the username is made file-name safe. */
export function backupFileName(username: string | null | undefined, date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const day = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const user = (username ?? '').replace(/[^A-Za-z0-9._-]+/g, '_') || 'utilisateur';
  return `elease-backup-${user}-${day}.json`;
}

function leaseToJson(lease: Lease): Record<string, unknown> {
  // Explicit list: nothing but the model leaves the app (no ACL, no internal field).
  return {
    objectId: lease.objectId,
    isPro: lease.isPro,
    name: lease.name,
    lot: lease.lot,
    streetNumber: lease.streetNumber,
    streetName: lease.streetName,
    optionalAddressInfo: lease.optionalAddressInfo,
    postalCode: lease.postalCode,
    city: lease.city,
    price: lease.price,
    charge: lease.charge,
    additionalCharges: lease.additionalCharges.map(({ title, amount }) => ({ title, amount })),
    lastSendDate: lease.lastSendDate,
    lastSentPeriod: lease.lastSentPeriod,
    lastSentPeriodAt: lease.lastSentPeriodAt,
    renewalDate: lease.renewalDate,
    indexType: lease.indexType,
    referenceIndexQuarter: lease.referenceIndexQuarter,
    referenceIndexValue: lease.referenceIndexValue,
    revisionReminderSentFor: lease.revisionReminderSentFor,
  };
}

/** The backup file: the legacy layout (an array of holders with their leases), indented like it. */
export function exportBackup(holders: readonly Leaseholder[]): Blob {
  const data = holders.map((holder) => ({
    objectId: holder.objectId,
    name: holder.name,
    email: holder.email,
    phone: holder.phone,
    leases: holder.leases.map(leaseToJson),
  }));
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

/**
 * Hands the file to the browser: an anchor with an object URL (works in Safari on iPhone and iPad), the
 * URL revoked a few seconds later, once the download has started.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------------------------------------------------------------------------------------
// Reading the file

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bad(where: string, field: string, expected: string): never {
  throw new BackupFileError(`Fichier invalide : ${where}, le champ « ${field} » ${expected}.`);
}

function textField(source: Json, key: string, where: string, required = false): string {
  const value = source[key];
  if (value === undefined || value === null) {
    return required ? bad(where, key, 'est absent') : '';
  }
  if (typeof value !== 'string') {
    return bad(where, key, 'doit être du texte');
  }
  if (value.length > MAX_TEXT) {
    return bad(where, key, 'est trop long');
  }
  if (required && value.trim() === '') {
    return bad(where, key, 'est vide');
  }
  return value;
}

function numberField(
  source: Json,
  key: string,
  where: string,
  options: {
    required?: boolean;
    min?: number;
    max?: number;
    integer?: boolean;
    above?: number;
  } = {},
): number | undefined {
  const value = source[key];
  if (value === undefined || value === null) {
    return options.required ? bad(where, key, 'est absent') : undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return bad(where, key, 'doit être un nombre');
  }
  if (
    (options.integer && !Number.isInteger(value)) ||
    value < (options.min ?? 0) ||
    value > (options.max ?? 1e9) ||
    (options.above !== undefined && value <= options.above)
  ) {
    return bad(where, key, `a une valeur impossible (${value})`);
  }
  return value;
}

function patternField(
  source: Json,
  key: string,
  where: string,
  pattern: RegExp,
): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || !pattern.test(value)) {
    return bad(where, key, 'a un format inattendu');
  }
  return value;
}

function parseCharges(source: Json, where: string): Lease['additionalCharges'] {
  const value = source['additionalCharges'];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 50) {
    return bad(where, 'additionalCharges', 'doit être une liste');
  }
  return value.map((entry) => {
    if (!isRecord(entry)) {
      return bad(where, 'additionalCharges', 'contient une ligne illisible');
    }
    return {
      title: textField(entry, 'title', where, true),
      amount: numberField(entry, 'amount', where, { required: true, max: 1e7 }) as number,
    };
  });
}

function parseLease(raw: unknown, where: string): Lease {
  if (!isRecord(raw)) {
    throw new BackupFileError(`Fichier invalide : ${where} n'est pas un bail lisible.`);
  }
  const name = textField(raw, 'name', where, true);
  const here = `${where} (« ${name} »)`;
  const isPro = raw['isPro'];
  if (isPro !== undefined && isPro !== null && typeof isPro !== 'boolean') {
    bad(here, 'isPro', 'doit être vrai ou faux');
  }
  const indexType = raw['indexType'];
  if (
    indexType !== undefined &&
    indexType !== null &&
    !INDEX_TYPES.includes(indexType as IndexType)
  ) {
    bad(here, 'indexType', 'doit être IRL, ILC ou ILAT');
  }
  const lastSentPeriod = patternField(raw, 'lastSentPeriod', here, /^\d{4}-(0[1-9]|1[0-2])$/);
  const lastSentPeriodAt = numberField(raw, 'lastSentPeriodAt', here, { max: 1e14 });
  const referenceIndexQuarter = patternField(raw, 'referenceIndexQuarter', here, /^\d{4}-T[1-4]$/);
  const referenceIndexValue = numberField(raw, 'referenceIndexValue', here, { above: 0, max: 1e6 });
  const revisionReminderSentFor = patternField(
    raw,
    'revisionReminderSentFor',
    here,
    /^\d{4}-\d{2}-\d{2}(:pending)?$/,
  );
  const objectId = typeof raw['objectId'] === 'string' ? raw['objectId'] : undefined;

  return {
    ...(objectId ? { objectId } : {}),
    isPro: isPro === true,
    name,
    lot: numberField(raw, 'lot', here, { integer: true, max: 1e6 }) ?? null,
    streetNumber: numberField(raw, 'streetNumber', here, { integer: true, max: 1e6 }) ?? 0,
    streetName: textField(raw, 'streetName', here),
    optionalAddressInfo: textField(raw, 'optionalAddressInfo', here),
    postalCode: numberField(raw, 'postalCode', here, { integer: true, max: 99999 }) ?? 0,
    city: textField(raw, 'city', here),
    price: numberField(raw, 'price', here, { required: true, max: 1e7 }) as number,
    charge: numberField(raw, 'charge', here, { max: 1e7 }) ?? null,
    additionalCharges: parseCharges(raw, here),
    lastSendDate: numberField(raw, 'lastSendDate', here, { max: 1e14 }) ?? 0,
    renewalDate: numberField(raw, 'renewalDate', here, { max: 1e14 }) ?? null,
    ...(lastSentPeriod !== undefined ? { lastSentPeriod } : {}),
    ...(lastSentPeriodAt !== undefined ? { lastSentPeriodAt } : {}),
    ...(indexType ? { indexType: indexType as IndexType } : {}),
    ...(referenceIndexQuarter !== undefined ? { referenceIndexQuarter } : {}),
    ...(referenceIndexValue !== undefined ? { referenceIndexValue } : {}),
    ...(revisionReminderSentFor !== undefined ? { revisionReminderSentFor } : {}),
  };
}

/**
 * The holders of a backup file's text. Strict about types (a number where text is expected, a negative
 * price, an unknown index family...) and lenient about what an old export may lack (phone, lot,
 * renewal date...), which gets the same defaults as when the app reads the server. Throws a
 * `BackupFileError` on anything else, before anything exists to be created.
 */
export function parseBackup(text: string): Leaseholder[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupFileError(
      "Ce fichier n'est pas une sauvegarde E-Lease : son contenu n'est pas du JSON lisible.",
    );
  }
  if (!Array.isArray(data)) {
    throw new BackupFileError(
      "Ce fichier n'est pas une sauvegarde E-Lease : une liste de locataires était attendue.",
    );
  }
  if (data.length === 0) {
    throw new BackupFileError('Cette sauvegarde ne contient aucun locataire.');
  }
  if (data.length > MAX_HOLDERS) {
    throw new BackupFileError(
      `Cette sauvegarde contient trop de locataires (plus de ${MAX_HOLDERS}).`,
    );
  }

  let leaseCount = 0;
  return data.map((raw, index): Leaseholder => {
    const where = `locataire n° ${index + 1}`;
    if (!isRecord(raw)) {
      throw new BackupFileError(`Fichier invalide : ${where} n'est pas lisible.`);
    }
    const name = textField(raw, 'name', where, true);
    const here = `${where} (« ${name} »)`;
    const rawLeases = raw['leases'];
    if (rawLeases !== undefined && rawLeases !== null && !Array.isArray(rawLeases)) {
      bad(here, 'leases', 'doit être une liste de baux');
    }
    const leases = (rawLeases ?? []) as unknown[];
    leaseCount += leases.length;
    if (leaseCount > MAX_LEASES) {
      throw new BackupFileError(`Cette sauvegarde contient trop de baux (plus de ${MAX_LEASES}).`);
    }
    const objectId = typeof raw['objectId'] === 'string' ? raw['objectId'] : undefined;
    return {
      ...(objectId ? { objectId } : {}),
      name,
      email: textField(raw, 'email', here),
      phone: textField(raw, 'phone', here),
      leases: leases.map((lease, i) => parseLease(lease, `${here}, bail n° ${i + 1}`)),
    };
  });
}

/** Reads and checks a file chosen by the user. The size is checked before the content is read. */
export async function readBackupFile(file: Blob): Promise<Leaseholder[]> {
  if (file.size > MAX_BACKUP_BYTES) {
    throw new BackupFileError(
      'Ce fichier est trop volumineux pour être une sauvegarde E-Lease (5 Mo au maximum).',
    );
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new BackupFileError("Le fichier n'a pas pu être lu. Choisissez-le à nouveau.");
  }
  return parseBackup(text);
}

// ---------------------------------------------------------------------------------------------
// Plan

export interface RestorePlan {
  /**
   * What will be created, in the order of the file. An entry WITHOUT `objectId` is a new holder, created
   * with all its `leases`. An entry WITH `objectId` is a holder that already exists (that id is the
   * existing holder's, never the file's) which lacks the listed `leases`: only those are added to it.
   * Leases never carry an id.
   */
  toCreate: Leaseholder[];
  /** Holders of the file that need nothing: already there with every one of their leases. */
  skipped: number;
  /** Leases of the file that are already there (in any holder), left out. */
  skippedLeases: number;
}

/** Without accents, case, repeated spaces: « Élodie  Dupont » equals « elodie dupont ». */
function norm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/\s+/g, ' ')
    .trim();
}

const holderKey = (holder: Leaseholder): string => `${norm(holder.name)}|${norm(holder.email)}`;

const leaseKey = (lease: Lease): string =>
  [
    norm(lease.name),
    lease.lot ?? 0,
    lease.streetNumber,
    norm(lease.streetName),
    lease.postalCode,
    norm(lease.city),
  ].join('|');

function withoutId<T extends { objectId?: string }>(value: T): Omit<T, 'objectId'> {
  const { objectId: _ignored, ...rest } = value;
  return rest;
}

/**
 * What a restore would do. « Already present » is decided in two ways:
 *  - by `objectId`: a holder (or a lease) of the file whose id exists in the current data is present;
 *    a lease whose id exists in ANY existing holder is present (ids are unique on the server);
 *  - by content, for what a previous restore created (restored objects get new ids, so a second run of
 *    the same file, or the retry of a partial one, would otherwise duplicate everything): a holder with
 *    the same name and e-mail, and within a present holder a lease with the same name, lot, street
 *    number, street, postal code and city. Each existing object matches at most one object of the file.
 *
 * A present holder that lacks leases of the file gets exactly those leases (`toCreate` entry with its
 * `objectId`). Nothing existing is ever modified. Holders of the file without an id are new.
 */
export function planRestore(
  file: readonly Leaseholder[],
  existing: readonly Leaseholder[],
): RestorePlan {
  const holdersById = new Map<string, Leaseholder>();
  const leaseIds = new Set<string>();
  for (const holder of existing) {
    if (holder.objectId) {
      holdersById.set(holder.objectId, holder);
    }
    for (const lease of holder.leases) {
      if (lease.objectId) {
        leaseIds.add(lease.objectId);
      }
    }
  }
  const claimedHolders = new Set<Leaseholder>();
  const claimedLeases = new Set<Lease>();
  const seenFileLeaseIds = new Set<string>();

  const toCreate: Leaseholder[] = [];
  /** New holders already in `toCreate`: a second copy of one in the file merges into it. */
  const created = new Map<string, Leaseholder>();
  let skipped = 0;
  let skippedLeases = 0;

  for (const fileHolder of file) {
    const key = holderKey(fileHolder);
    let match = fileHolder.objectId ? holdersById.get(fileHolder.objectId) : undefined;
    if (!match) {
      match = existing.find(
        (candidate) => !claimedHolders.has(candidate) && holderKey(candidate) === key,
      );
    }
    if (match) {
      claimedHolders.add(match);
    }
    // A holder already planned for creation (listed twice in the file).
    const twin = match ? undefined : (created.get(fileHolder.objectId ?? '') ?? created.get(key));
    const known = match?.leases ?? twin?.leases ?? [];

    const missing: Lease[] = [];
    for (const lease of fileHolder.leases) {
      const id = lease.objectId;
      let present = id !== undefined && (leaseIds.has(id) || seenFileLeaseIds.has(id));
      if (!present && known.length > 0) {
        const leaseId = leaseKey(lease);
        const same = known.find(
          (candidate) => !claimedLeases.has(candidate) && leaseKey(candidate) === leaseId,
        );
        if (same) {
          claimedLeases.add(same);
          present = true;
        }
      }
      if (id !== undefined) {
        seenFileLeaseIds.add(id);
      }
      if (present) {
        skippedLeases += 1;
      } else {
        missing.push(withoutId(lease));
      }
    }

    if (twin) {
      twin.leases.push(...missing);
      skipped += missing.length === 0 ? 1 : 0;
    } else if (!match) {
      const entry: Leaseholder = { ...withoutId(fileHolder), leases: missing };
      toCreate.push(entry);
      created.set(key, entry);
      if (fileHolder.objectId) {
        created.set(fileHolder.objectId, entry);
      }
    } else if (missing.length > 0) {
      toCreate.push({ ...match, leases: missing });
    } else {
      skipped += 1;
    }
  }
  return { toCreate, skipped, skippedLeases };
}

export interface PlanCounts {
  /** Holders that will be created. */
  newHolders: number;
  /** Existing holders that will receive leases. */
  completedHolders: number;
  /** Leases that will be created, in both cases. */
  leases: number;
}

export function planCounts(plan: RestorePlan): PlanCounts {
  const newHolders = plan.toCreate.filter((holder) => !holder.objectId).length;
  return {
    newHolders,
    completedHolders: plan.toCreate.length - newHolders,
    leases: plan.toCreate.reduce((sum, holder) => sum + holder.leases.length, 0),
  };
}

/** The name of the account a backup file name says it belongs to (`elease-backup-<name>-<date>.json`). */
function fileOwner(fileName: string): string | null {
  const match = /^elease-backup-(.+)-\d{4}-\d{2}-\d{2}(?: ?\(\d+\))?\.json$/i.exec(fileName);
  return match ? match[1] : null;
}

/**
 * Things the user should know before confirming: a file name that names another account, and a file
 * that has nothing in common with what exists (an existing account whose holders are all unknown to the
 * file is more likely another account's backup than a recovery).
 */
export function restoreWarnings(input: {
  fileName: string;
  username: string | null;
  fileHolders: readonly Leaseholder[];
  existing: readonly Leaseholder[];
  plan: RestorePlan;
}): string[] {
  const warnings: string[] = [];
  const owner = fileOwner(input.fileName);
  if (owner && input.username && owner.toLowerCase() !== input.username.toLowerCase()) {
    warnings.push(
      `Le nom du fichier indique le compte « ${owner} », vous êtes connecté en tant que « ${input.username} ». Vérifiez qu'il s'agit bien de vos données.`,
    );
  }
  const common = input.fileHolders.length - planCounts(input.plan).newHolders;
  if (input.existing.length > 0 && common === 0) {
    warnings.push(
      "Aucun locataire du fichier n'existe déjà dans vos données : ce fichier vient peut-être d'un autre compte.",
    );
  }
  return warnings;
}

// ---------------------------------------------------------------------------------------------
// Apply

export interface RestoreFailure {
  holder: string;
  /** Absent when the holder itself could not be created. */
  lease?: string;
  /** The server did not answer: the object may exist all the same. */
  uncertain: boolean;
  error: unknown;
}

export interface RestoreReport {
  holdersCreated: number;
  leasesCreated: number;
  /** Leases that were not created because of a failure or of the stop (all of them, not only failures). */
  leasesNotCreated: number;
  failures: RestoreFailure[];
  /** The session ended (Parse 209): the rest was not attempted. */
  stopped: boolean;
  /** Everything of the plan was created, and nothing else happened. */
  ok: boolean;
}

/**
 * Creates what the plan lists, one object at a time, through the repository (owner-only ACL, nothing
 * written that the model does not have: never `isSelected` nor `indexing`; the bookkeeping of the
 * leases, `lastSendDate`, `lastSentPeriod`, `lastSentPeriodAt`, is kept). A failure does not stop the
 * others: it is recorded and the next object is tried, except an expired session, which ends the run.
 * The report never says ok unless everything was created; the caller reloads the data afterwards.
 */
export async function applyRestore(
  plan: RestorePlan,
  repository: Pick<LeaseholderRepository, 'createLeaseholder' | 'addLease'>,
): Promise<RestoreReport> {
  const report: RestoreReport = {
    holdersCreated: 0,
    leasesCreated: 0,
    leasesNotCreated: 0,
    failures: [],
    stopped: false,
    ok: false,
  };

  for (let index = 0; index < plan.toCreate.length; index += 1) {
    const entry = plan.toCreate[index];
    if (report.stopped) {
      report.leasesNotCreated += entry.leases.length;
      continue;
    }
    let holderId = entry.objectId;
    if (!holderId) {
      try {
        const created = await repository.createLeaseholder({
          name: entry.name,
          email: entry.email,
          phone: entry.phone,
        });
        holderId = created.objectId;
        report.holdersCreated += 1;
      } catch (error) {
        record(report, { holder: entry.name, error });
        report.leasesNotCreated += entry.leases.length;
        continue;
      }
    }
    if (!holderId) {
      record(report, { holder: entry.name, error: new Error('Locataire sans identifiant.') });
      report.leasesNotCreated += entry.leases.length;
      continue;
    }
    for (const lease of entry.leases) {
      if (report.stopped) {
        report.leasesNotCreated += 1;
        continue;
      }
      try {
        await repository.addLease(holderId, lease);
        report.leasesCreated += 1;
      } catch (error) {
        record(report, { holder: entry.name, lease: lease.name, error });
        report.leasesNotCreated += 1;
      }
    }
  }
  report.ok = report.failures.length === 0 && !report.stopped;
  return report;
}

function record(
  report: RestoreReport,
  failure: { holder: string; lease?: string; error: unknown },
): void {
  report.failures.push({ ...failure, uncertain: failure.error instanceof BackendTimeoutError });
  if (isSessionError(failure.error)) {
    report.stopped = true;
  }
}
