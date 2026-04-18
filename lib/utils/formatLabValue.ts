/**
 * Format a lab value for display without duplicating the unit.
 *
 * Some extracted observations store the unit inside `value_text` (e.g., "8.5%")
 * AND in the dedicated `unit` column ("%"), which would naively render as
 * "8.5% %". This helper strips trailing-unit duplication.
 */
export function formatLabValue(
  valueText: string | null | undefined,
  unit: string | null | undefined,
): string {
  const value = (valueText ?? '').trim();
  const u = (unit ?? '').trim();
  if (!value && !u) return '';
  if (!u) return value;
  if (!value) return u;
  if (value.toLowerCase().endsWith(u.toLowerCase())) return value;
  return `${value} ${u}`;
}
