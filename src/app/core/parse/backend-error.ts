import { INVALID_SESSION_TOKEN } from './parse-client';
import { BackendTimeoutError } from './with-timeout';

/** Parse error code for "the server could not be reached" (CONNECTION_FAILED). */
const CONNECTION_FAILED = 100;
const CONNECTION_TITLE = 'Connexion requise';

/** What a screen shows when a load or a save failed. */
export interface BackendErrorInfo {
  title: string;
  message: string;
  /** Whether a « Réessayer » button makes sense. */
  retryable: boolean;
}

function codeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? (error as { code?: unknown }).code
    : undefined;
}

function isDeviceOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * Whether the failure is a missing connection: the device is offline, the backend did not answer in
 * time, or Parse could not reach it (code 100).
 */
export function isConnectionError(error: unknown, online: boolean = isDeviceOnline()): boolean {
  return !online || error instanceof BackendTimeoutError || codeOf(error) === CONNECTION_FAILED;
}

/**
 * Turns a backend failure into French wording for the user: a missing connection (offline, the backend
 * not answering in time, or Parse code 100) asks for a connection and can be retried; an expired
 * session (209) says so and is not retryable, because the login screen takes over; anything else is a
 * generic retryable error. Raw error messages are never shown.
 */
export function describeBackendError(
  error: unknown,
  online: boolean = isDeviceOnline(),
): BackendErrorInfo {
  if (!online) {
    return {
      title: CONNECTION_TITLE,
      message: 'Vous semblez hors connexion. Reconnectez-vous à internet, puis réessayez.',
      retryable: true,
    };
  }
  if (error instanceof BackendTimeoutError) {
    return {
      title: CONNECTION_TITLE,
      message: 'Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.',
      retryable: true,
    };
  }
  if (isConnectionError(error, online)) {
    return {
      title: CONNECTION_TITLE,
      message: 'Impossible de joindre le serveur. Vérifiez votre connexion, puis réessayez.',
      retryable: true,
    };
  }
  if (codeOf(error) === INVALID_SESSION_TOKEN) {
    return {
      title: 'Session expirée',
      message: 'Votre session a expiré. Veuillez vous reconnecter pour continuer.',
      retryable: false,
    };
  }
  return {
    title: 'Une erreur est survenue',
    message: 'Le chargement a échoué. Réessayez dans un instant.',
    retryable: true,
  };
}
