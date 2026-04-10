/**
 * Minimal appointment templates. Used by the Visit Prep generator to seed
 * a starter purpose summary and a small set of generic questions when the
 * appointment lacks profile context to personalize from.
 *
 * The detailed checklist-style templates that used to live here have been
 * replaced — the new model is a single cohesive Visit Prep object generated
 * by `services/appointmentPlanGenerator.ts`.
 */

import type { AppointmentType } from '@/lib/types/appointments';

export interface AppointmentTypeTemplate {
  /** Default summary used when the appointment has no explicit purpose. */
  default_purpose: string;
  /** A small set of generic fallback questions when no profile context exists. */
  fallback_questions: string[];
}

export const APPOINTMENT_TEMPLATES: Record<AppointmentType, AppointmentTypeTemplate> = {
  doctor: {
    default_purpose: 'Routine check-in with your provider.',
    fallback_questions: [
      'Are there any tests or screenings I should consider at this visit?',
      'Are my current medications still the right ones for me?',
    ],
  },
  labs: {
    default_purpose: 'Lab work ordered by your provider.',
    fallback_questions: [
      'Is fasting required, and for how long?',
      'When and how will I get the results?',
    ],
  },
  imaging: {
    default_purpose: 'Imaging study ordered by your provider.',
    fallback_questions: [
      'Will contrast dye be used, and is there any prep I need to do?',
      'When will my provider review the results with me?',
    ],
  },
  procedure: {
    default_purpose: 'Procedure scheduled with your provider.',
    fallback_questions: [
      'What should I expect during recovery, and what should I watch for?',
      'Which of my current medications should I take or hold the morning of?',
    ],
  },
  therapy: {
    default_purpose: 'Therapy session with your provider.',
    fallback_questions: [
      'What goals should we focus on for this session?',
      'Is there anything I should practice before the next visit?',
    ],
  },
  other: {
    default_purpose: 'Healthcare appointment.',
    fallback_questions: [
      'What should I bring to this visit?',
      'What are the next steps after this appointment?',
    ],
  },
};
