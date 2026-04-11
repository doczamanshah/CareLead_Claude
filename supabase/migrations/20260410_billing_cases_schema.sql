-- ══════════════════════════════════════════════════════════════════════
-- Migration: Bills & EOBs Module (Phase 2)
-- Creates billing tables: cases, documents, extraction jobs, ledger lines,
-- findings, actions, call logs, payments, denials, appeals, contacts,
-- case parties, and status events.
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. billing_contacts ──────────────────────────────────────────────
-- Reusable directory of provider/payer/pharmacy contacts.
-- Created first because billing_case_parties references it.

CREATE TABLE billing_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  contact_type  TEXT NOT NULL
                CHECK (contact_type IN ('provider', 'payer', 'pharmacy', 'other')),
  name          TEXT NOT NULL,
  phone         TEXT,
  fax           TEXT,
  email         TEXT,
  portal_url    TEXT,
  address       TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_contacts_profile_id ON billing_contacts(profile_id);
CREATE INDEX idx_billing_contacts_household_id ON billing_contacts(household_id);
CREATE INDEX idx_billing_contacts_contact_type ON billing_contacts(contact_type);

CREATE TRIGGER trg_billing_contacts_updated_at
  BEFORE UPDATE ON billing_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. billing_cases ─────────────────────────────────────────────────
-- The core unit of work — one case per billing event.

CREATE TABLE billing_cases (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id                  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id                UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title                       TEXT NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'open'
                              CHECK (status IN (
                                'open', 'in_review', 'action_plan',
                                'in_progress', 'resolved', 'closed'
                              )),
  provider_name               TEXT,
  payer_name                  TEXT,
  service_date_start          DATE,
  service_date_end            DATE,
  total_billed                NUMERIC(12,2),
  total_allowed               NUMERIC(12,2),
  total_plan_paid             NUMERIC(12,2),
  total_patient_responsibility NUMERIC(12,2),
  totals_confidence           NUMERIC(3,2) CHECK (totals_confidence IS NULL OR (totals_confidence >= 0 AND totals_confidence <= 1)),
  last_extracted_at           TIMESTAMPTZ,
  last_reconciled_at          TIMESTAMPTZ,
  external_ref                TEXT,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_cases_profile_id ON billing_cases(profile_id);
CREATE INDEX idx_billing_cases_household_id ON billing_cases(household_id);
CREATE INDEX idx_billing_cases_status ON billing_cases(status);

CREATE TRIGGER trg_billing_cases_updated_at
  BEFORE UPDATE ON billing_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 3. billing_documents ─────────────────────────────────────────────
-- Bills, EOBs, itemized bills, and denial letters attached to a case.

CREATE TABLE billing_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_case_id  UUID NOT NULL REFERENCES billing_cases(id) ON DELETE CASCADE,
  profile_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id     UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  doc_type         TEXT NOT NULL
                   CHECK (doc_type IN ('bill', 'eob', 'itemized_bill', 'denial', 'other')),
  file_path        TEXT NOT NULL,
  file_name        TEXT,
  mime_type        TEXT,
  source           TEXT NOT NULL DEFAULT 'upload'
                   CHECK (source IN ('upload', 'fhir')),
  extracted_json   JSONB,
  quality_score    NUMERIC(3,2) CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 1)),
  quality_signals  JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_documents_billing_case_id ON billing_documents(billing_case_id);
CREATE INDEX idx_billing_documents_profile_id ON billing_documents(profile_id);
CREATE INDEX idx_billing_documents_household_id ON billing_documents(household_id);
CREATE INDEX idx_billing_documents_doc_type ON billing_documents(doc_type);

-- ── 4. billing_extract_jobs ──────────────────────────────────────────
-- Tracks AI extraction runs against billing documents.

CREATE TABLE billing_extract_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_case_id     UUID NOT NULL REFERENCES billing_cases(id) ON DELETE CASCADE,
  billing_document_id UUID REFERENCES billing_documents(id) ON DELETE SET NULL,
  profile_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id        UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  result_json         JSONB,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_extract_jobs_billing_case_id ON billing_extract_jobs(billing_case_id);
CREATE INDEX idx_billing_extract_jobs_profile_id ON billing_extract_jobs(profile_id);
CREATE INDEX idx_billing_extract_jobs_household_id ON billing_extract_jobs(household_id);
CREATE INDEX idx_billing_extract_jobs_status ON billing_extract_jobs(status);

-- ── 5. billing_ledger_lines ──────────────────────────────────────────
-- Individual line items from bills and EOBs, with bill↔eob matching.

CREATE TABLE billing_ledger_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_case_id     UUID NOT NULL REFERENCES billing_cases(id) ON DELETE CASCADE,
  billing_document_id UUID REFERENCES billing_documents(id) ON DELETE SET NULL,
  profile_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id        UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  line_kind           TEXT NOT NULL
                      CHECK (line_kind IN ('total', 'bill_line', 'eob_line')),
  description         TEXT,
  service_date        DATE,
  procedure_code      TEXT,
  amount_billed       NUMERIC(12,2),
  amount_allowed      NUMERIC(12,2),
  amount_plan_paid    NUMERIC(12,2),
  amount_patient      NUMERIC(12,2),
  confidence          NUMERIC(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  evidence_snippet    TEXT,
  evidence_context    TEXT,
  evidence_page_hint  TEXT,
  external_line_key   TEXT,
  matched_line_id     UUID REFERENCES billing_ledger_lines(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(billing_case_id, external_line_key)
);

CREATE INDEX idx_billing_ledger_lines_billing_case_id ON billing_ledger_lines(billing_case_id);
CREATE INDEX idx_billing_ledger_lines_billing_document_id ON billing_ledger_lines(billing_document_id);
CREATE INDEX idx_billing_ledger_lines_profile_id ON billing_ledger_lines(profile_id);
CREATE INDEX idx_billing_ledger_lines_household_id ON billing_ledger_lines(household_id);
CREATE INDEX idx_billing_ledger_lines_external_line_key ON billing_ledger_lines(external_line_key);

-- ── 6. billing_case_findings ─────────────────────────────────────────
-- Reconciliation findings — discrepancies, missing docs, denials, etc.

CREATE TABLE billing_case_findings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_case_id     UUID NOT NULL REFERENCES billing_cases(id) ON DELETE CASCADE,
  profile_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id        UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  severity            TEXT NOT NULL
                      CHECK (severity IN ('info', 'warning', 'critical')),
  code                TEXT NOT NULL,
  message             TEXT NOT NULL,
  evidence            JSONB,
  recommended_actions JSONB,
  is_resolved         BOOLEAN NOT NULL DEFAULT false,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(billing_case_id, code)
);

CREATE INDEX idx_billing_case_findings_billing_case_id ON billing_case_findings(billing_case_id);
CREATE INDEX idx_billing_case_findings_profile_id ON billing_case_findings(profile_id);
CREATE INDEX idx_billing_case_findings_household_id ON billing_case_findings(household_id);
CREATE INDEX idx_billing_case_findings_severity ON billing_case_findings(severity);

-- ── 7. billing_case_actions ──────────────────────────────────────────
-- Action plan items for resolving billing issues.

CREATE TABLE billing_case_actions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_case_id  UUID NOT NULL REFERENCES billing_cases(id) ON DELETE CASCADE,
  profile_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id     UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  action_type      TEXT NOT NULL
                   CHECK (action_type IN (
                     'upload_eob', 'request_itemized_bill', 'call_provider_billing',
                     'call_insurer', 'request_refund', 'appeal_denial', 'other'
                   )),
  status           TEXT NOT NULL DEFAULT 'proposed'
                   CHECK (status IN ('proposed', 'active', 'in_progress', 'done', 'dismissed')),
  title            TEXT NOT NULL,
  description      TEXT,
  due_at           TIMESTAMPTZ,
  linked_task_id   UUID REFERENCES tasks(id) ON DELETE SET NULL,
  activated_at     TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_case_actions_billing_case_id ON billing_case_actions(billing_case_id);
CREATE INDEX idx_billing_case_actions_profile_id ON billing_case_actions(profile_id);
CREATE INDEX idx_billing_case_actions_household_id ON billing_case_actions(household_id);
CREATE INDEX idx_billing_case_actions_status ON billing_case_actions(status);

CREATE TRIGGER trg_billing_case_actions_updated_at
  BEFORE UPDATE ON billing_case_actions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 8. billing_case_call_logs ────────────────────────────────────────
-- Structured log of phone calls made for a billing case.

CREATE TABLE billing_case_call_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_case_id   UUID NOT NULL REFERENCES billing_cases(id) ON DELETE CASCADE,
  billing_action_id UUID REFERENCES billing_case_actions(id) ON DELETE SET NULL,
  profile_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id      UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  party             TEXT NOT NULL
                    CHECK (party IN ('provider', 'payer', 'pharmacy', 'other')),
  party_name        TEXT,
  phone_number      TEXT,
  called_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_minutes  INTEGER,
  rep_name          TEXT,
  reference_number  TEXT,
  outcome           TEXT,
  next_steps        TEXT,
  follow_up_due     TIMESTAMPTZ,
  created_task_id   UUID REFERENCES tasks(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_case_call_logs_billing_case_id ON billing_case_call_logs(billing_case_id);
CREATE INDEX idx_billing_case_call_logs_billing_action_id ON billing_case_call_logs(billing_action_id);
CREATE INDEX idx_billing_case_call_logs_profile_id ON billing_case_call_logs(profile_id);
CREATE INDEX idx_billing_case_call_logs_household_id ON billing_case_call_logs(household_id);

-- ── 9. billing_case_payments ─────────────────────────────────────────
-- Payments made and refunds received for a billing case.

CREATE TABLE billing_case_payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_case_id  UUID NOT NULL REFERENCES billing_cases(id) ON DELETE CASCADE,
  profile_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id     UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL
                   CHECK (kind IN ('payment', 'refund')),
  amount           NUMERIC(12,2) NOT NULL,
  paid_at          DATE NOT NULL,
  method           TEXT,
  note             TEXT,
  external_ref     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_case_payments_billing_case_id ON billing_case_payments(billing_case_id);
CREATE INDEX idx_billing_case_payments_profile_id ON billing_case_payments(profile_id);
CREATE INDEX idx_billing_case_payments_household_id ON billing_case_payments(household_id);

-- ── 10. billing_denial_records ───────────────────────────────────────
-- Denial information extracted from EOBs and denial letters.

CREATE TABLE billing_denial_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_case_id     UUID NOT NULL REFERENCES billing_cases(id) ON DELETE CASCADE,
  billing_document_id UUID REFERENCES billing_documents(id) ON DELETE SET NULL,
  profile_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id        UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category            TEXT
                      CHECK (category IN (
                        'prior_auth', 'medical_necessity', 'not_covered',
                        'timely_filing', 'coding_error', 'duplicate', 'other'
                      )),
  denial_reason       TEXT,
  keywords            JSONB,
  codes               JSONB,
  deadline            DATE,
  confidence          NUMERIC(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  evidence            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_denial_records_billing_case_id ON billing_denial_records(billing_case_id);
CREATE INDEX idx_billing_denial_records_billing_document_id ON billing_denial_records(billing_document_id);
CREATE INDEX idx_billing_denial_records_profile_id ON billing_denial_records(profile_id);
CREATE INDEX idx_billing_denial_records_household_id ON billing_denial_records(household_id);

-- ── 11. billing_appeal_packets ───────────────────────────────────────
-- Appeal preparation and tracking.

CREATE TABLE billing_appeal_packets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_case_id     UUID NOT NULL REFERENCES billing_cases(id) ON DELETE CASCADE,
  billing_denial_id   UUID REFERENCES billing_denial_records(id) ON DELETE SET NULL,
  profile_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id        UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'ready', 'submitted', 'accepted', 'rejected')),
  letter_draft        TEXT,
  checklist           JSONB,
  included_doc_ids    JSONB,
  submitted_at        TIMESTAMPTZ,
  outcome             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_appeal_packets_billing_case_id ON billing_appeal_packets(billing_case_id);
CREATE INDEX idx_billing_appeal_packets_billing_denial_id ON billing_appeal_packets(billing_denial_id);
CREATE INDEX idx_billing_appeal_packets_profile_id ON billing_appeal_packets(profile_id);
CREATE INDEX idx_billing_appeal_packets_household_id ON billing_appeal_packets(household_id);
CREATE INDEX idx_billing_appeal_packets_status ON billing_appeal_packets(status);

CREATE TRIGGER trg_billing_appeal_packets_updated_at
  BEFORE UPDATE ON billing_appeal_packets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 12. billing_case_parties ─────────────────────────────────────────
-- Links a billing case to its provider and payer contacts with claim details.

CREATE TABLE billing_case_parties (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_case_id     UUID NOT NULL REFERENCES billing_cases(id) ON DELETE CASCADE,
  profile_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id        UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  provider_contact_id UUID REFERENCES billing_contacts(id) ON DELETE SET NULL,
  payer_contact_id    UUID REFERENCES billing_contacts(id) ON DELETE SET NULL,
  claim_number        TEXT,
  member_id           TEXT,
  plan_name           TEXT,
  group_number        TEXT,
  provider_npi        TEXT,
  provider_tin        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_case_parties_billing_case_id ON billing_case_parties(billing_case_id);
CREATE INDEX idx_billing_case_parties_profile_id ON billing_case_parties(profile_id);
CREATE INDEX idx_billing_case_parties_household_id ON billing_case_parties(household_id);

CREATE TRIGGER trg_billing_case_parties_updated_at
  BEFORE UPDATE ON billing_case_parties
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 13. billing_case_status_events ───────────────────────────────────
-- Append-only log of case status transitions.

CREATE TABLE billing_case_status_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_case_id  UUID NOT NULL REFERENCES billing_cases(id) ON DELETE CASCADE,
  profile_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id     UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  from_status      TEXT,
  to_status        TEXT NOT NULL,
  changed_by       TEXT NOT NULL DEFAULT 'user'
                   CHECK (changed_by IN ('user', 'system')),
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_case_status_events_billing_case_id ON billing_case_status_events(billing_case_id);
CREATE INDEX idx_billing_case_status_events_profile_id ON billing_case_status_events(profile_id);
CREATE INDEX idx_billing_case_status_events_household_id ON billing_case_status_events(household_id);


-- ══════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════════════
-- All 13 tables use the same pattern: access gated through has_profile_access().
-- household_id is denormalized for query convenience; RLS is enforced via profile_id.

-- billing_contacts
ALTER TABLE billing_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_contacts_select ON billing_contacts FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY billing_contacts_insert ON billing_contacts FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY billing_contacts_update ON billing_contacts FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY billing_contacts_delete ON billing_contacts FOR DELETE
  USING (has_profile_access(profile_id));

-- billing_cases
ALTER TABLE billing_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_cases_select ON billing_cases FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY billing_cases_insert ON billing_cases FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY billing_cases_update ON billing_cases FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY billing_cases_delete ON billing_cases FOR DELETE
  USING (has_profile_access(profile_id));

-- billing_documents
ALTER TABLE billing_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_documents_select ON billing_documents FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY billing_documents_insert ON billing_documents FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY billing_documents_update ON billing_documents FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY billing_documents_delete ON billing_documents FOR DELETE
  USING (has_profile_access(profile_id));

-- billing_extract_jobs
ALTER TABLE billing_extract_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_extract_jobs_select ON billing_extract_jobs FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY billing_extract_jobs_insert ON billing_extract_jobs FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY billing_extract_jobs_update ON billing_extract_jobs FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY billing_extract_jobs_delete ON billing_extract_jobs FOR DELETE
  USING (has_profile_access(profile_id));

-- billing_ledger_lines
ALTER TABLE billing_ledger_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_ledger_lines_select ON billing_ledger_lines FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY billing_ledger_lines_insert ON billing_ledger_lines FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY billing_ledger_lines_update ON billing_ledger_lines FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY billing_ledger_lines_delete ON billing_ledger_lines FOR DELETE
  USING (has_profile_access(profile_id));

-- billing_case_findings
ALTER TABLE billing_case_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_case_findings_select ON billing_case_findings FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY billing_case_findings_insert ON billing_case_findings FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY billing_case_findings_update ON billing_case_findings FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY billing_case_findings_delete ON billing_case_findings FOR DELETE
  USING (has_profile_access(profile_id));

-- billing_case_actions
ALTER TABLE billing_case_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_case_actions_select ON billing_case_actions FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY billing_case_actions_insert ON billing_case_actions FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY billing_case_actions_update ON billing_case_actions FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY billing_case_actions_delete ON billing_case_actions FOR DELETE
  USING (has_profile_access(profile_id));

-- billing_case_call_logs
ALTER TABLE billing_case_call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_case_call_logs_select ON billing_case_call_logs FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY billing_case_call_logs_insert ON billing_case_call_logs FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY billing_case_call_logs_update ON billing_case_call_logs FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY billing_case_call_logs_delete ON billing_case_call_logs FOR DELETE
  USING (has_profile_access(profile_id));

-- billing_case_payments
ALTER TABLE billing_case_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_case_payments_select ON billing_case_payments FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY billing_case_payments_insert ON billing_case_payments FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY billing_case_payments_update ON billing_case_payments FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY billing_case_payments_delete ON billing_case_payments FOR DELETE
  USING (has_profile_access(profile_id));

-- billing_denial_records
ALTER TABLE billing_denial_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_denial_records_select ON billing_denial_records FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY billing_denial_records_insert ON billing_denial_records FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY billing_denial_records_update ON billing_denial_records FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY billing_denial_records_delete ON billing_denial_records FOR DELETE
  USING (has_profile_access(profile_id));

-- billing_appeal_packets
ALTER TABLE billing_appeal_packets ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_appeal_packets_select ON billing_appeal_packets FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY billing_appeal_packets_insert ON billing_appeal_packets FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY billing_appeal_packets_update ON billing_appeal_packets FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY billing_appeal_packets_delete ON billing_appeal_packets FOR DELETE
  USING (has_profile_access(profile_id));

-- billing_case_parties
ALTER TABLE billing_case_parties ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_case_parties_select ON billing_case_parties FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY billing_case_parties_insert ON billing_case_parties FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY billing_case_parties_update ON billing_case_parties FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY billing_case_parties_delete ON billing_case_parties FOR DELETE
  USING (has_profile_access(profile_id));

-- billing_case_status_events (append-only — no UPDATE or DELETE policies)
ALTER TABLE billing_case_status_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_case_status_events_select ON billing_case_status_events FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY billing_case_status_events_insert ON billing_case_status_events FOR INSERT
  WITH CHECK (has_profile_access(profile_id));
