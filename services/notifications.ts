/**
 * Notification PHI protection policy.
 *
 * Push / local notifications are rendered on the device lock screen, in the
 * notification tray, on watches, and can be captured in logs/analytics
 * services. Any PHI included in a notification is effectively outside our
 * controlled zone. Rule: **no PHI in notification content, ever.**
 *
 * This module provides `sanitizeNotificationContent` — a last line of defense
 * that rewrites any notification payload into a generic form before it is
 * scheduled or dispatched. All modules that send notifications MUST route
 * through this utility.
 *
 * Examples (never → always):
 *   "Take your Lisinopril"              →  "You have a medication reminder"
 *   "Your A1c is 7.2%"                  →  "A new result is available"
 *   "Appointment with Dr. Chen"         →  "You have an upcoming appointment"
 *   "Bill from Memorial Hospital: $1,125"→  "A billing update is available"
 *   "Mom's refill is due tomorrow"      →  "A medication refill is due"
 *
 * Never include any of these in notification content:
 *   • Patient names (including relationship labels like "Mom")
 *   • Medication names, strengths, or dosing
 *   • Lab values, reference ranges, or interpretations
 *   • Provider names or facility names
 *   • Diagnoses, conditions, or allergy details
 *   • Bill amounts, insurance plan names, or denial specifics
 *   • Appointment types (e.g., "oncology"), procedure names
 *
 * Keyword-based detection here is deliberately conservative — when in doubt,
 * we fall back to the category-specific generic template. It is not a
 * substitute for discipline at the call site.
 */

export type NotificationCategory =
  | 'medication'
  | 'appointment'
  | 'billing'
  | 'result'
  | 'task'
  | 'preventive'
  | 'general';

interface SanitizeInput {
  title: string;
  body: string;
  category?: NotificationCategory;
}

interface SanitizedNotification {
  title: string;
  body: string;
}

const GENERIC_TEMPLATES: Record<NotificationCategory, SanitizedNotification> = {
  medication: {
    title: 'Medication reminder',
    body: 'You have a medication reminder. Open CareLead to view the details.',
  },
  appointment: {
    title: 'Appointment reminder',
    body: 'You have an upcoming appointment. Open CareLead to view the details.',
  },
  billing: {
    title: 'Billing update',
    body: 'A billing update is available. Open CareLead to view the details.',
  },
  result: {
    title: 'New result available',
    body: 'A new result is available. Open CareLead to view the details.',
  },
  task: {
    title: 'Task reminder',
    body: 'You have a task to review. Open CareLead to view the details.',
  },
  preventive: {
    title: 'Preventive care',
    body: 'A preventive care item needs attention. Open CareLead to view the details.',
  },
  general: {
    title: 'CareLead',
    body: 'You have an update in CareLead. Open the app to view the details.',
  },
};

// Keyword heuristics — err toward sanitizing. Case-insensitive matches.
const PHI_SIGNAL_PATTERNS: RegExp[] = [
  // Money (billing)
  /\$\d/,
  // Dose-like patterns (number + mg/ml/mcg/g/unit(s))
  /\b\d+(\.\d+)?\s?(mg|mcg|g|ml|unit|units|tab|tabs|tablet|tablets|cap|caps|capsule|capsules)\b/i,
  // Lab-value-like: number with % or common units, or flags
  /\b\d+(\.\d+)?\s?(%|mmol\/l|mg\/dl|mmhg|bpm)\b/i,
  /\b(high|low|abnormal|critical|positive|negative)\b/i,
  // Provider titles
  /\bdr\.?\s+[a-z]/i,
  // Specific medical terms that indicate PHI context
  /\b(diagnosis|diagnosed|prognosis|allergic|allergy\b.*\bto\b)/i,
];

function looksLikePhi(text: string): boolean {
  if (!text) return false;
  return PHI_SIGNAL_PATTERNS.some((r) => r.test(text));
}

/**
 * Sanitize a notification payload, returning a PHI-free version suitable for
 * scheduling. If the supplied content passes all heuristic checks it may be
 * returned unchanged, but call sites should still prefer generic templates.
 *
 * When `category` is provided and any PHI signal is detected, we drop the
 * original text entirely and return the category template.
 */
export function sanitizeNotificationContent(
  params: SanitizeInput,
): SanitizedNotification {
  const { title, body, category = 'general' } = params;

  const combined = `${title ?? ''} ${body ?? ''}`;
  if (looksLikePhi(combined)) {
    return GENERIC_TEMPLATES[category];
  }

  // Even without PHI signals, keep the title generic if the caller did not
  // provide one. Body is allowed to pass through if it is free of detectable
  // PHI signals — but callers are strongly encouraged to use the templates.
  return {
    title: title && title.trim().length > 0 ? title : GENERIC_TEMPLATES[category].title,
    body: body && body.trim().length > 0 ? body : GENERIC_TEMPLATES[category].body,
  };
}

/**
 * Convenience: look up the generic template for a category. Call sites that
 * never have safe content (e.g., medication reminders where the drug name is
 * always PHI) should use this directly rather than attempting sanitization.
 */
export function genericNotification(
  category: NotificationCategory,
): SanitizedNotification {
  return GENERIC_TEMPLATES[category];
}
