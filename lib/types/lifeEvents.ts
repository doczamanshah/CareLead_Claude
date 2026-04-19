/**
 * Life-event trigger types.
 *
 * These describe moments of meaningful change in a patient's health profile
 * (new insurance, new medication, etc.) and the short follow-up prompts
 * CareLead surfaces in response. Prompts are always dismissible, always
 * optional — they're supposed to feel like a thoughtful assistant noticing
 * context, not a system demanding more data.
 */

export type LifeEventType =
  | 'insurance_added'
  | 'insurance_updated'
  | 'provider_added'
  | 'medication_added'
  | 'medication_stopped'
  | 'condition_added'
  | 'appointment_created'
  | 'result_added'
  | 'caregiver_added'
  | 'address_changed';

export type LifeEventPromptPriority = 'high' | 'medium' | 'low';

export type LifeEventQuickAction =
  | 'dismiss'
  | 'confirm'
  | 'add_condition'
  | 'add_care_team'
  | 'custom';

export interface LifeEventAction {
  label: string;
  route?: string;
  params?: Record<string, string>;
  quickAction?: LifeEventQuickAction;
  /**
   * Stable identifier for an inline handler that the rendering screen
   * wires up (e.g. "archive_condition", "open_share_sheet"). Keeps the
   * store serializable — we don't store function references.
   */
  handler?: string;
  /** Payload consumed by the handler, e.g. conditionFactId, medicationId. */
  handlerPayload?: Record<string, unknown>;
  /** Render as the filled primary button (vs outline secondary). */
  primary?: boolean;
}

export interface LifeEventPrompt {
  id: string;
  triggerEvent: LifeEventType;
  /** Profile this prompt belongs to — prompts never leak across profiles. */
  profileId: string;
  title: string;
  detail: string;
  priority: LifeEventPromptPriority;
  actions: LifeEventAction[];
  createdAt: string;
}
