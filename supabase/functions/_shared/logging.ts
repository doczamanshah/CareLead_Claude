/**
 * PHI-safe logging helpers for Edge Functions.
 *
 * Edge Function console output is written to Supabase's Edge Function logs,
 * which are a controlled zone — but even inside that zone we minimize PHI
 * per HIPAA's "minimum necessary" standard. These helpers log only the
 * non-PHI metadata needed to diagnose failures:
 *   • status codes
 *   • error codes / names
 *   • short, static error messages written by us
 *
 * What we explicitly never log:
 *   • Raw request/response bodies (may echo extracted medication names, lab
 *     values, provider names, or verbatim patient input)
 *   • Supabase error.message strings that interpolate row data
 *   • Claude API response text (may contain all of the above)
 *   • Uploaded document contents or OCR text
 */

export interface LogMeta {
  [key: string]: string | number | boolean | null | undefined;
}

/** Log a non-error event. Metadata must be non-PHI (IDs, counts, flags). */
export function logInfo(event: string, meta?: LogMeta): void {
  if (meta && Object.keys(meta).length > 0) {
    console.log(`[${event}]`, JSON.stringify(meta));
  } else {
    console.log(`[${event}]`);
  }
}

/**
 * Log an error PHI-safely. Keeps the static message + optional meta and
 * summarizes the thrown value to its type/code only.
 */
export function logError(event: string, err?: unknown, meta?: LogMeta): void {
  const combined: LogMeta = { ...(meta ?? {}) };
  const summary = summarizeError(err);
  if (summary) combined.err = summary;
  if (Object.keys(combined).length > 0) {
    console.error(`[${event}]`, JSON.stringify(combined));
  } else {
    console.error(`[${event}]`);
  }
}

function summarizeError(err: unknown): string | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) {
    return err.name;
  }
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.name === 'string') parts.push(obj.name);
    if (typeof obj.code === 'string') parts.push(`code=${obj.code}`);
    if (typeof obj.status === 'number') parts.push(`status=${obj.status}`);
    return parts.length > 0 ? parts.join(' ') : 'Error';
  }
  return undefined;
}
