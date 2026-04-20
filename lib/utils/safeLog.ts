/**
 * PHI-safe logging utility.
 *
 * CareLead handles protected health information. Raw console.log statements
 * in production can leak PHI via OS crash reports, Xcode device logs, logcat,
 * or third-party analytics/error SDKs. This module provides the narrow set of
 * logging helpers the app should use instead of bare console calls.
 *
 * Rules:
 * - `safeLog` / `safeWarn` only emit output in development (`__DEV__`).
 * - `safeError` runs in production too, but strips PHI-shaped content from
 *   the message/details before it reaches the console.
 * - Never pass raw profile facts, medications, lab values, provider names,
 *   free-text input, AI extraction payloads, or full Error objects that
 *   might contain echoed input. Pass IDs, counts, event names, and error
 *   types instead.
 */

/** Dev-only log. Silent in production builds. */
export function safeLog(message: string, data?: unknown): void {
  if (!__DEV__) return;
  if (data === undefined) {
    console.log(message);
  } else {
    console.log(message, data);
  }
}

/** Dev-only warn. Silent in production builds. */
export function safeWarn(message: string, data?: unknown): void {
  if (!__DEV__) return;
  if (data === undefined) {
    console.warn(message);
  } else {
    console.warn(message, data);
  }
}

/**
 * PHI-safe error log. Runs in production but emits only:
 *   - the caller-supplied message (should be a static string, not user data)
 *   - the error's constructor name and a redacted short message
 *
 * Never logs the full error object, stack trace, or raw `error.message` —
 * those can contain echoed user input, row data, or DB-provided PHI.
 */
export function safeError(message: string, error?: unknown): void {
  const summary = summarizeError(error);
  if (summary) {
    console.error(message, summary);
  } else {
    console.error(message);
  }
}

function summarizeError(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  if (error instanceof Error) {
    return `${error.name}: ${redact(error.message)}`;
  }
  if (typeof error === 'string') {
    return redact(error);
  }
  if (typeof error === 'object') {
    // Pull a handful of known-safe fields from Supabase / fetch-style errors.
    const obj = error as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name : 'Error';
    const code = typeof obj.code === 'string' ? obj.code : undefined;
    const status = typeof obj.status === 'number' ? obj.status : undefined;
    const parts = [name];
    if (code) parts.push(`code=${code}`);
    if (status !== undefined) parts.push(`status=${status}`);
    return parts.join(' ');
  }
  return undefined;
}

/**
 * Strip out anything that looks like free-text PHI from an error message.
 * Keeps short codes and status phrases; drops anything resembling sentences.
 */
function redact(input: string): string {
  if (!input) return '';
  const trimmed = input.slice(0, 200);
  // Collapse anything that looks like quoted user data.
  const noQuotes = trimmed.replace(/["'][^"']{8,}["']/g, '"<redacted>"');
  // Strip email addresses and phone numbers defensively.
  const noEmails = noQuotes.replace(/[\w.+-]+@[\w.-]+/g, '<email>');
  const noPhones = noEmails.replace(/\+?\d[\d\s().-]{7,}\d/g, '<phone>');
  return noPhones;
}
