/**
 * Canonicalizes a raw gender/sex string (from onboarding, profile edit, the
 * micro-capture prompt, or legacy imports) into the tight 'male' | 'female'
 * space the preventive eligibility engine uses to match criteria.sex.
 *
 * Anything outside that space (null, empty, 'Non-binary', 'Other',
 * 'Prefer not to say', unknown values) returns null — the caller should treat
 * null as "sex-specific rules cannot be evaluated yet."
 */
export function normalizeSexForEligibility(
  value: string | null | undefined,
): 'male' | 'female' | null {
  if (!value) return null;
  const v = value.toLowerCase().trim();
  if (v === 'm' || v === 'male' || v === 'man') return 'male';
  if (v === 'f' || v === 'female' || v === 'woman') return 'female';
  return null;
}
