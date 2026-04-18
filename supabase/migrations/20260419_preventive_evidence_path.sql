-- Adds a file path column for the document that proves a preventive screening
-- was completed. The existing last_done_evidence_id (UUID) was intended for
-- linking to an artifacts/documents row, but document-backed completion in
-- the MVP stores files directly in the result-documents storage bucket and
-- keeps the path on the preventive_item row for simplicity.

ALTER TABLE preventive_items
  ADD COLUMN last_done_evidence_path TEXT;
