-- Add freeform_input column to billing_cases for patient-voice-first case creation.
-- Stores raw user-provided text describing the bill. AI extraction comes in a later step.
ALTER TABLE billing_cases ADD COLUMN freeform_input text;
