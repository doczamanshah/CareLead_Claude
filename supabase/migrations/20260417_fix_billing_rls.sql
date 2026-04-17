-- ══════════════════════════════════════════════════════════════════════
-- Fix: Billing module RLS — storage policies for the billing-documents bucket
-- ══════════════════════════════════════════════════════════════════════
-- Context
-- -------
-- Uploads from the billing module (add-document.tsx and the "Snap a Bill"
-- flow in create.tsx) were failing with "new row violates row-level
-- security policy" during the storage upload step.
--
-- Root cause: storage.objects has RLS enabled (set up for the "artifacts"
-- bucket in 00003_fix_rls_policies.sql), but no policies were ever created
-- for the "billing-documents" bucket. With RLS on and no matching policy,
-- Postgres rejects every INSERT.
--
-- The billing_documents TABLE policies are already correct (they follow
-- the has_profile_access(profile_id) pattern used by all other tables),
-- so only the storage-side policies need to be added.
--
-- Path convention
-- ---------------
-- Service writes files at: {householdId}/{caseId}/{uuid}.{ext}
-- Therefore (storage.foldername(name))[1] is the household_id, so we
-- gate access via is_household_member() rather than has_profile_access().
-- ══════════════════════════════════════════════════════════════════════

-- Make sure RLS is enabled on storage.objects (it should already be on
-- from the artifacts bucket setup, but be explicit in case it was toggled).
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- INSERT: authenticated users can upload to paths under households they belong to
DROP POLICY IF EXISTS billing_documents_storage_insert ON storage.objects;
CREATE POLICY billing_documents_storage_insert ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'billing-documents'
    AND is_household_member((storage.foldername(name))[1]::UUID)
  );

-- SELECT: authenticated users can read objects under households they belong to
DROP POLICY IF EXISTS billing_documents_storage_select ON storage.objects;
CREATE POLICY billing_documents_storage_select ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'billing-documents'
    AND is_household_member((storage.foldername(name))[1]::UUID)
  );

-- UPDATE: authenticated users can update objects under households they belong to
DROP POLICY IF EXISTS billing_documents_storage_update ON storage.objects;
CREATE POLICY billing_documents_storage_update ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'billing-documents'
    AND is_household_member((storage.foldername(name))[1]::UUID)
  );

-- DELETE: authenticated users can delete objects under households they belong to
DROP POLICY IF EXISTS billing_documents_storage_delete ON storage.objects;
CREATE POLICY billing_documents_storage_delete ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'billing-documents'
    AND is_household_member((storage.foldername(name))[1]::UUID)
  );
