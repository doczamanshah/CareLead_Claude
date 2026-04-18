-- ══════════════════════════════════════════════════════════════════════
-- Migration: Results (Labs/Imaging) Module (Phase 2)
-- Creates results tables: items (unified lab/imaging/other), documents,
-- normalized lab observations (trend-ready), and extraction jobs.
-- Also adds storage policies for the "result-documents" bucket.
-- ══════════════════════════════════════════════════════════════════════
-- NOTE: A private Supabase Storage bucket named "result-documents" must
-- be created manually in the Dashboard (Storage > New Bucket > name:
-- result-documents, private: true) before uploads will work.
-- Path convention: {householdId}/{resultId}/{uuid}.{ext}
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. result_items ──────────────────────────────────────────────────
-- Unified entity for labs, imaging reports, and other test results.

CREATE TABLE result_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id       UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  result_type        TEXT NOT NULL
                     CHECK (result_type IN ('lab', 'imaging', 'other')),
  test_name          TEXT NOT NULL,
  performed_at       DATE,
  reported_at        DATE,
  facility           TEXT,
  ordering_clinician TEXT,
  source_method      TEXT NOT NULL DEFAULT 'typed'
                     CHECK (source_method IN ('typed', 'dictated', 'document', 'import')),
  raw_text           TEXT,
  structured_data    JSONB,
  field_confidence   JSONB,
  user_corrections   JSONB,
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'processing', 'needs_review', 'ready', 'archived')),
  tags               JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_pinned          BOOLEAN NOT NULL DEFAULT false,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_result_items_profile_id ON result_items(profile_id);
CREATE INDEX idx_result_items_household_id ON result_items(household_id);
CREATE INDEX idx_result_items_result_type ON result_items(result_type);
CREATE INDEX idx_result_items_status ON result_items(status);
CREATE INDEX idx_result_items_performed_at ON result_items(performed_at);
CREATE INDEX idx_result_items_is_pinned ON result_items(is_pinned);
CREATE INDEX idx_result_items_test_name ON result_items(test_name);

CREATE TRIGGER trg_result_items_updated_at
  BEFORE UPDATE ON result_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. result_documents ──────────────────────────────────────────────
-- Files attached to a result item (uploaded PDFs, photos, scans).

CREATE TABLE result_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id       UUID NOT NULL REFERENCES result_items(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id    UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  file_path       TEXT NOT NULL,
  file_name       TEXT,
  mime_type       TEXT,
  source          TEXT NOT NULL DEFAULT 'upload'
                  CHECK (source IN ('upload', 'photo', 'scan')),
  extracted_text  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_result_documents_result_id ON result_documents(result_id);
CREATE INDEX idx_result_documents_profile_id ON result_documents(profile_id);

-- ── 3. result_lab_observations ───────────────────────────────────────
-- Normalized lab analyte values for trend queries.

CREATE TABLE result_lab_observations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id      UUID NOT NULL REFERENCES result_items(id) ON DELETE CASCADE,
  profile_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id   UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  analyte_name   TEXT NOT NULL,
  analyte_code   TEXT,
  numeric_value  NUMERIC(12,4),
  value_text     TEXT,
  unit           TEXT,
  ref_range_low  NUMERIC(12,4),
  ref_range_high NUMERIC(12,4),
  ref_range_text TEXT,
  flag           TEXT
                 CHECK (flag IS NULL OR flag IN ('normal', 'high', 'low', 'abnormal', 'critical')),
  observed_at    DATE,
  confidence     NUMERIC(3,2)
                 CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  source         TEXT NOT NULL DEFAULT 'extracted'
                 CHECK (source IN ('extracted', 'user_confirmed', 'user_entered')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_result_lab_observations_result_id ON result_lab_observations(result_id);
CREATE INDEX idx_result_lab_observations_profile_id ON result_lab_observations(profile_id);
CREATE INDEX idx_result_lab_observations_analyte_name ON result_lab_observations(analyte_name);
CREATE INDEX idx_result_lab_observations_observed_at ON result_lab_observations(observed_at);

-- ── 4. result_extract_jobs ───────────────────────────────────────────
-- Tracks AI extraction runs against result documents.

CREATE TABLE result_extract_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id      UUID NOT NULL REFERENCES result_items(id) ON DELETE CASCADE,
  profile_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id   UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  result_json    JSONB,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_result_extract_jobs_result_id ON result_extract_jobs(result_id);
CREATE INDEX idx_result_extract_jobs_status ON result_extract_jobs(status);


-- ══════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════════════
-- All 4 tables use the same pattern: access gated through has_profile_access().
-- household_id is denormalized for query convenience; RLS is enforced via profile_id.

-- result_items
ALTER TABLE result_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY result_items_select ON result_items FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY result_items_insert ON result_items FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY result_items_update ON result_items FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY result_items_delete ON result_items FOR DELETE
  USING (has_profile_access(profile_id));

-- result_documents
ALTER TABLE result_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY result_documents_select ON result_documents FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY result_documents_insert ON result_documents FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY result_documents_update ON result_documents FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY result_documents_delete ON result_documents FOR DELETE
  USING (has_profile_access(profile_id));

-- result_lab_observations
ALTER TABLE result_lab_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY result_lab_observations_select ON result_lab_observations FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY result_lab_observations_insert ON result_lab_observations FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY result_lab_observations_update ON result_lab_observations FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY result_lab_observations_delete ON result_lab_observations FOR DELETE
  USING (has_profile_access(profile_id));

-- result_extract_jobs
ALTER TABLE result_extract_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY result_extract_jobs_select ON result_extract_jobs FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY result_extract_jobs_insert ON result_extract_jobs FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY result_extract_jobs_update ON result_extract_jobs FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY result_extract_jobs_delete ON result_extract_jobs FOR DELETE
  USING (has_profile_access(profile_id));


-- ══════════════════════════════════════════════════════════════════════
-- STORAGE POLICIES — "result-documents" bucket
-- ══════════════════════════════════════════════════════════════════════
-- Service writes files at: {householdId}/{resultId}/{uuid}.{ext}
-- Therefore (storage.foldername(name))[1] is the household_id, so we
-- gate access via is_household_member() — same pattern as billing-documents.
-- The bucket itself must be created manually in the Supabase Dashboard.

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- INSERT: authenticated users can upload to paths under households they belong to
DROP POLICY IF EXISTS result_documents_storage_insert ON storage.objects;
CREATE POLICY result_documents_storage_insert ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'result-documents'
    AND is_household_member((storage.foldername(name))[1]::UUID)
  );

-- SELECT: authenticated users can read objects under households they belong to
DROP POLICY IF EXISTS result_documents_storage_select ON storage.objects;
CREATE POLICY result_documents_storage_select ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'result-documents'
    AND is_household_member((storage.foldername(name))[1]::UUID)
  );

-- UPDATE: authenticated users can update objects under households they belong to
DROP POLICY IF EXISTS result_documents_storage_update ON storage.objects;
CREATE POLICY result_documents_storage_update ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'result-documents'
    AND is_household_member((storage.foldername(name))[1]::UUID)
  );

-- DELETE: authenticated users can delete objects under households they belong to
DROP POLICY IF EXISTS result_documents_storage_delete ON storage.objects;
CREATE POLICY result_documents_storage_delete ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'result-documents'
    AND is_household_member((storage.foldername(name))[1]::UUID)
  );
