-- Add 'immunization' as a valid category for profile_facts so health summary
-- imports (CCD/CCDA) can store immunization entries alongside the other
-- profile data categories.

ALTER TABLE profile_facts DROP CONSTRAINT IF EXISTS profile_facts_category_check;

ALTER TABLE profile_facts
  ADD CONSTRAINT profile_facts_category_check
  CHECK (category IN (
    'condition', 'allergy', 'medication', 'surgery',
    'family_history', 'insurance', 'care_team', 'pharmacy',
    'emergency_contact', 'goal', 'measurement', 'immunization'
  ));
