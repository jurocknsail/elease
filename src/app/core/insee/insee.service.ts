import { Injectable } from '@angular/core';
import { XMLParser } from 'fast-xml-parser';
import { IndexType } from '../models/lease';
import { INSEE_SERIES } from '../revision/revision';

const BASE_URL = 'https://api.insee.fr/series/BDM/V1/data/SERIES_BDM';
/** How many quarters are asked for: far more than the one or two the revision needs. */
const LAST_OBSERVATIONS = 24;
export const INSEE_TIMEOUT_MS = 15_000;

/** An INSEE period, 'YYYY-Qn'. */
const PERIOD = /^\d{4}-Q[1-4]$/;

/**
 * The index values could not be obtained: no connection, no answer in time, an HTTP error or an answer
 * that is not what the BDM returns. The message is French, short and fit to show; it never mentions a
 * key (the public statistics need none).
 */
export class InseeUnavailableError extends Error {
  constructor(
    readonly reason: 'offline' | 'timeout' | 'http' | 'format',
    cause?: unknown,
  ) {
    super(
      reason === 'offline'
        ? 'Vous semblez hors connexion. Les indices INSEE seront chargés au retour de la connexion.'
        : reason === 'timeout'
          ? "L'INSEE ne répond pas. Réessayez dans un instant."
          : 'Les indices INSEE sont momentanément indisponibles. Réessayez dans un instant.',
      { cause },
    );
    this.name = 'InseeUnavailableError';
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  processEntities: false,
  // One observation or one series is an object, several are arrays: always read lists.
  isArray: (name) => name === 'Series' || name === 'Obs',
});

/**
 * The observations of a BDM answer (SDMX-ML structure specific data): 'YYYY-Qn' -> value. Lines that
 * are not a quarter with a finite positive value are skipped; an answer with none at all is refused,
 * so that an empty or unexpected document is never taken for "nothing published".
 */
export function parseObservations(xml: string): Map<string, number> {
  const result = new Map<string, number>();
  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch (error) {
    throw new InseeUnavailableError('format', error);
  }
  const root = (document as Record<string, Record<string, unknown> | undefined>)[
    'StructureSpecificData'
  ];
  const dataSet = root?.['DataSet'] as
    { Series?: { Obs?: Record<string, string>[] }[] } | undefined;
  for (const series of dataSet?.Series ?? []) {
    for (const obs of series.Obs ?? []) {
      const period = String(obs['TIME_PERIOD'] ?? '');
      const value = Number(obs['OBS_VALUE']);
      if (PERIOD.test(period) && Number.isFinite(value) && value > 0) {
        result.set(period, value);
      }
    }
  }
  if (result.size === 0) {
    throw new InseeUnavailableError('format');
  }
  return result;
}

/**
 * The published housing/commercial rent indices from INSEE's BDM, public statistics: no key, no
 * account. `observations(type)` is fetched once per session and kept; a failure is never kept, the
 * next call asks again. Several calls at the same time share one request.
 */
@Injectable({ providedIn: 'root' })
export class InseeService {
  private readonly cache = new Map<IndexType, Promise<Map<string, number>>>();

  /** The recent values of an index family, 'YYYY-Qn' -> value (e.g. '2026-Q2' -> 138.01). */
  observations(type: IndexType): Promise<Map<string, number>> {
    let pending = this.cache.get(type);
    if (!pending) {
      pending = this.fetchObservations(type);
      this.cache.set(type, pending);
      pending.catch(() => {
        if (this.cache.get(type) === pending) {
          this.cache.delete(type);
        }
      });
    }
    return pending;
  }

  private async fetchObservations(type: IndexType): Promise<Map<string, number>> {
    const url = `${BASE_URL}/${INSEE_SERIES[type]}?lastNObservations=${LAST_OBSERVATIONS}`;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, INSEE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/xml' },
      });
      if (!response.ok) {
        throw new InseeUnavailableError('http');
      }
      return parseObservations(await response.text());
    } catch (error) {
      if (error instanceof InseeUnavailableError) {
        throw error;
      }
      throw new InseeUnavailableError(
        timedOut
          ? 'timeout'
          : typeof navigator !== 'undefined' && !navigator.onLine
            ? 'offline'
            : 'http',
        error,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
