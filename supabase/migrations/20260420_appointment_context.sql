-- Phase 3 — Item 3b: Freeform Appointment Creation
--
-- Capture the additional context that a patient provides when they dictate
-- a new appointment: the reason for the visit, specific concerns they want
-- to raise with the provider, who's coming with them, how they're getting
-- there, any special prep needs, and the raw freeform text they originally
-- said. This context is read by visit-prep generation so the initial
-- question list is tailored to what the patient actually cares about.
--
-- Shape (stored as jsonb):
-- {
--   "reason_for_visit": string,
--   "concerns_to_discuss": string[],
--   "companion": string,
--   "transportation": string,
--   "special_needs": string[],
--   "prep_notes": string,
--   "freeform_input": string
-- }

ALTER TABLE apt_appointments
  ADD COLUMN IF NOT EXISTS context_json JSONB;
