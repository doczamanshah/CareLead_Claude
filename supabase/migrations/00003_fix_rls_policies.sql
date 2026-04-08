-- ============================================================================
-- Fix RLS Policies
-- Addresses INSERT failures on artifacts (and related tables) caused by:
--   1. STABLE caching on helper functions
--   2. Missing created_by default on artifacts
--   3. Missing storage bucket policies
--   4. Missing DELETE policies for cleanup operations
-- ============================================================================

-- ============================================================================
-- 1. RECREATE HELPER FUNCTIONS
--    Remove STABLE hint to prevent cross-statement caching within a
--    transaction, and add explicit NULL guard for auth.uid().
-- ============================================================================

CREATE OR REPLACE FUNCTION is_household_member(p_household_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM household_members
    WHERE household_id = p_household_id
      AND user_id = v_uid
      AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION has_profile_access(p_profile_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM profiles p
    JOIN household_members hm ON hm.household_id = p.household_id
    WHERE p.id = p_profile_id
      AND hm.user_id = v_uid
      AND hm.status = 'active'
      AND p.deleted_at IS NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 2. ADD DEFAULT for created_by on artifacts and tasks
--    So the Supabase client doesn't need to manually pass it.
-- ============================================================================

ALTER TABLE artifacts
  ALTER COLUMN created_by SET DEFAULT auth.uid();

ALTER TABLE tasks
  ALTER COLUMN created_by SET DEFAULT auth.uid();

-- ============================================================================
-- 3. FIX ARTIFACTS POLICIES
--    Add DELETE policy (needed for cleanup on failed upload).
--    Re-create INSERT policy with explicit uid check as a belt-and-suspenders
--    approach alongside the function.
-- ============================================================================

-- Drop existing INSERT policy and re-create with a direct check
DROP POLICY IF EXISTS artifacts_insert ON artifacts;
CREATE POLICY artifacts_insert ON artifacts FOR INSERT
  WITH CHECK (
    has_profile_access(profile_id)
    AND (created_by IS NULL OR created_by = auth.uid())
  );

-- Add DELETE policy (only your own artifacts, within your household)
DROP POLICY IF EXISTS artifacts_delete ON artifacts;
CREATE POLICY artifacts_delete ON artifacts FOR DELETE
  USING (
    has_profile_access(profile_id)
    AND created_by = auth.uid()
  );

-- ============================================================================
-- 4. FIX EXTRACTED_FIELDS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS extracted_fields_insert ON extracted_fields;
CREATE POLICY extracted_fields_insert ON extracted_fields FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

-- Add DELETE policy for cleanup
DROP POLICY IF EXISTS extracted_fields_delete ON extracted_fields;
CREATE POLICY extracted_fields_delete ON extracted_fields FOR DELETE
  USING (has_profile_access(profile_id));

-- ============================================================================
-- 5. FIX INTENT_SHEETS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS intent_sheets_insert ON intent_sheets;
CREATE POLICY intent_sheets_insert ON intent_sheets FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

DROP POLICY IF EXISTS intent_sheets_delete ON intent_sheets;
CREATE POLICY intent_sheets_delete ON intent_sheets FOR DELETE
  USING (has_profile_access(profile_id));

-- ============================================================================
-- 6. FIX INTENT_ITEMS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS intent_items_insert ON intent_items;
CREATE POLICY intent_items_insert ON intent_items FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

DROP POLICY IF EXISTS intent_items_delete ON intent_items;
CREATE POLICY intent_items_delete ON intent_items FOR DELETE
  USING (has_profile_access(profile_id));

-- ============================================================================
-- 7. FIX TASKS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS tasks_insert ON tasks;
CREATE POLICY tasks_insert ON tasks FOR INSERT
  WITH CHECK (
    has_profile_access(profile_id)
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS tasks_delete ON tasks;
CREATE POLICY tasks_delete ON tasks FOR DELETE
  USING (
    has_profile_access(profile_id)
    AND created_by = auth.uid()
  );

-- ============================================================================
-- 8. STORAGE BUCKET POLICIES (storage.objects RLS)
--    The bucket "artifacts" must exist (create via Dashboard as a private bucket).
--
--    Storage path convention: {profile_id}/{artifact_id}/{file_name}
--    The first path segment is the profile_id, used for access checks.
-- ============================================================================

-- Ensure RLS is enabled on storage.objects (Supabase enables this by default,
-- but be explicit in case it was toggled off).
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Upload: authenticated users can INSERT into paths under profiles they belong to
DROP POLICY IF EXISTS artifacts_storage_insert ON storage.objects;
CREATE POLICY artifacts_storage_insert ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'artifacts'
    AND has_profile_access((storage.foldername(name))[1]::UUID)
  );

-- Read: authenticated users can SELECT objects under profiles they belong to
DROP POLICY IF EXISTS artifacts_storage_select ON storage.objects;
CREATE POLICY artifacts_storage_select ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'artifacts'
    AND has_profile_access((storage.foldername(name))[1]::UUID)
  );

-- Update: authenticated users can UPDATE objects under profiles they belong to
DROP POLICY IF EXISTS artifacts_storage_update ON storage.objects;
CREATE POLICY artifacts_storage_update ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'artifacts'
    AND has_profile_access((storage.foldername(name))[1]::UUID)
  );

-- Delete: authenticated users can DELETE objects under profiles they belong to
DROP POLICY IF EXISTS artifacts_storage_delete ON storage.objects;
CREATE POLICY artifacts_storage_delete ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'artifacts'
    AND has_profile_access((storage.foldername(name))[1]::UUID)
  );
