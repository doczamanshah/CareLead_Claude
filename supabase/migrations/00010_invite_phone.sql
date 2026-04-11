-- Add phone number support for caregiver invites
ALTER TABLE caregiver_invites ADD COLUMN IF NOT EXISTS invited_phone TEXT;

-- Make invited_email nullable (phone-only invites won't have email)
ALTER TABLE caregiver_invites ALTER COLUMN invited_email DROP NOT NULL;
