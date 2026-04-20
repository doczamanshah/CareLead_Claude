/**
 * User-facing error message sanitizer.
 *
 * Raw error messages from Supabase, the Claude API, network stacks, and
 * Postgres all can (and do) embed row data, column values, or echoed user
 * input — anything of which may be PHI. This helper maps recognizable
 * error shapes to short, generic copy and drops everything else.
 *
 * Use this at every UI boundary that displays an error to the user
 * (Alert.alert, inline error text, error state screens). Log the original
 * error via `safeLog`/`safeError` if you need it for debugging — don't
 * show it to the user.
 */

import { safeLog } from '@/lib/utils/safeLog';

export interface SanitizeOptions {
  /** Override the default fallback message. */
  fallback?: string;
}

const DEFAULT_FALLBACK =
  'Something went wrong. Please try again.';

const NETWORK_MESSAGE =
  'Unable to connect. Please check your internet connection and try again.';

const AUTH_MESSAGE =
  'Your session has expired. Please sign in again.';

const RATE_LIMIT_MESSAGE =
  'CareLead is busy right now. Please try again in a moment.';

const EXTRACTION_MESSAGE =
  "We couldn't process that. Please try again or enter the information manually.";

/**
 * Return a user-safe error string. Never passes a raw error.message through.
 * Logs the original error (dev-only) so a developer can still diagnose.
 */
export function sanitizeErrorMessage(
  error: unknown,
  options: SanitizeOptions = {},
): string {
  safeLog('[sanitizeError]', error);

  const fallback = options.fallback ?? DEFAULT_FALLBACK;

  if (error === null || error === undefined) return fallback;

  const raw = extractRawMessage(error).toLowerCase();
  if (!raw) return fallback;

  if (looksLikeNetwork(raw)) return NETWORK_MESSAGE;
  if (looksLikeAuth(raw)) return AUTH_MESSAGE;
  if (looksLikeRateLimit(raw)) return RATE_LIMIT_MESSAGE;
  if (looksLikeExtraction(raw)) return EXTRACTION_MESSAGE;
  if (looksLikeDatabase(raw)) return fallback;

  // We don't recognize the shape — always prefer a generic fallback over
  // echoing a raw message that may contain user data.
  return fallback;
}

function extractRawMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message ?? '';
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
    if (typeof obj.error_description === 'string') return obj.error_description;
  }
  return '';
}

function looksLikeNetwork(raw: string): boolean {
  return (
    raw.includes('network') ||
    raw.includes('fetch') ||
    raw.includes('failed to load') ||
    raw.includes('timeout') ||
    raw.includes('timed out') ||
    raw.includes('offline') ||
    raw.includes('connection')
  );
}

function looksLikeAuth(raw: string): boolean {
  return (
    raw.includes('jwt') ||
    raw.includes('unauthorized') ||
    raw.includes('not authenticated') ||
    raw.includes('invalid token') ||
    raw.includes('token expired') ||
    raw.includes('session expired') ||
    raw.includes('auth session missing')
  );
}

function looksLikeRateLimit(raw: string): boolean {
  return (
    raw.includes('rate limit') ||
    raw.includes('too many requests') ||
    raw.includes('429')
  );
}

function looksLikeExtraction(raw: string): boolean {
  return (
    raw.includes('extraction') ||
    raw.includes('ai returned') ||
    raw.includes('ai processing') ||
    raw.includes('ai extraction') ||
    raw.includes('parse') ||
    raw.includes('claude')
  );
}

function looksLikeDatabase(raw: string): boolean {
  return (
    raw.includes('duplicate key') ||
    raw.includes('constraint') ||
    raw.includes('foreign key') ||
    raw.includes('not null') ||
    raw.includes('violates') ||
    raw.includes('syntax')
  );
}
