// Deploy with:
// supabase functions deploy extract-billing --no-verify-jwt --project-ref ccpxoidlqsolzypmkiul
//
// Requires ANTHROPIC_API_KEY set as a Supabase Edge Function secret
// (should already be set from the extract-document function).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logError } from "../_shared/logging.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// ── Document extraction prompt ─────────────────────────────────────────────

const DOCUMENT_EXTRACTION_PROMPT = `You are a medical billing extraction assistant. Extract structured data from this medical billing document.

Return ONLY valid JSON with this exact structure:
{
  "document_type": "bill" | "eob" | "itemized_bill" | "denial" | "unknown",
  "provider_name": string or null,
  "payer_name": string or null,
  "service_date_start": "YYYY-MM-DD" or null,
  "service_date_end": "YYYY-MM-DD" or null,
  "totals": {
    "billed": number or null,
    "allowed": number or null,
    "plan_paid": number or null,
    "patient_responsibility": number or null,
    "confidence": number between 0 and 1
  },
  "line_items": [
    {
      "description": string,
      "service_date": "YYYY-MM-DD" or null,
      "procedure_code": string or null,
      "amount_billed": number or null,
      "amount_allowed": number or null,
      "amount_plan_paid": number or null,
      "amount_patient": number or null,
      "confidence": number between 0 and 1,
      "evidence_snippet": string (the exact text from the document that this line came from)
    }
  ],
  "denial_detected": boolean,
  "denial_info": {
    "category": "prior_auth" | "medical_necessity" | "not_covered" | "timely_filing" | "coding_error" | "duplicate" | "other" | null,
    "reason": string or null,
    "appeal_deadline": "YYYY-MM-DD" or null,
    "confidence": number between 0 and 1,
    "evidence_snippet": string or null
  } or null,
  "claim_number": string or null,
  "member_id": string or null,
  "plan_name": string or null,
  "group_number": string or null,
  "quality_assessment": {
    "score": number between 0 and 1,
    "issues": string[] (e.g., ["blurry text", "partial document", "handwritten notes"])
  }
}

Extract ONLY what is explicitly present in the document. Do not infer or guess. Set fields to null if not found. Confidence scores should reflect how clearly the information was readable. Return valid JSON only, no markdown, no explanation.`;

// ── Freeform extraction prompt ─────────────────────────────────────────────

const FREEFORM_EXTRACTION_PROMPT = `You are a medical billing assistant. A patient has described a billing situation in their own words. Extract any structured billing information you can identify.

Return ONLY valid JSON with this exact structure:
{
  "suggested_title": string (a concise, descriptive title for this billing case based on what the patient described, e.g., "Memorial Hospital ER Visit - March 2026"),
  "provider_name": string or null,
  "payer_name": string or null,
  "service_date_start": "YYYY-MM-DD" or null,
  "service_date_end": "YYYY-MM-DD" or null,
  "totals": {
    "billed": number or null,
    "allowed": number or null,
    "plan_paid": number or null,
    "patient_responsibility": number or null,
    "confidence": number between 0 and 1
  },
  "claim_number": string or null,
  "member_id": string or null,
  "plan_name": string or null,
  "group_number": string or null,
  "denial_detected": boolean,
  "denial_info": {
    "category": "prior_auth" | "medical_necessity" | "not_covered" | "timely_filing" | "coding_error" | "duplicate" | "other" | null,
    "reason": string or null,
    "appeal_deadline": "YYYY-MM-DD" or null,
    "confidence": number between 0 and 1
  } or null,
  "additional_context": string or null (any other relevant details the patient mentioned that don't fit the fields above)
}

Extract ONLY what the patient explicitly stated. Do not infer or assume. Set fields to null if not mentioned. Confidence should reflect how clearly the patient stated the information. Return valid JSON only, no markdown, no explanation.`;

// ── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseExtractionJson(raw: string): Record<string, unknown> | null {
  try {
    const clean = raw
      .replace(/^```json?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

async function callClaude(
  anthropicApiKey: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: unknown }>,
): Promise<{ text: string } | { error: string; status: number }> {
  const resp = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    }),
  });

  if (!resp.ok) {
    await resp.text().catch(() => undefined);
    logError("extract-billing.claude_error", undefined, { status: resp.status });
    return { error: `Claude API error: ${resp.status}`, status: 502 };
  }

  const result = await resp.json();
  const textBlock = result.content?.find(
    (b: { type: string }) => b.type === "text",
  );
  if (!textBlock?.text) {
    return { error: "Empty response from Claude API", status: 502 };
  }
  return { text: textBlock.text };
}

// ── Store extraction results (shared by both modes) ────────────────────────

interface StoreResultsParams {
  supabase: ReturnType<typeof createClient>;
  extraction: Record<string, unknown>;
  caseId: string;
  profileId: string;
  householdId: string;
  documentId: string | null;
  jobId: string;
  mode: "document" | "freeform";
}

async function storeExtractionResults(params: StoreResultsParams) {
  const { supabase, extraction, caseId, profileId, householdId, documentId, jobId, mode } = params;

  // ── Update billing_documents (document mode only) ──
  if (mode === "document" && documentId) {
    const qualityAssessment = extraction.quality_assessment as
      | { score?: number; issues?: string[] }
      | undefined;

    await supabase
      .from("billing_documents")
      .update({
        extracted_json: extraction,
        quality_score: qualityAssessment?.score ?? null,
        quality_signals: qualityAssessment ?? null,
      })
      .eq("id", documentId);
  }

  // ── Update billing_cases ──
  const totals = extraction.totals as
    | {
        billed?: number | null;
        allowed?: number | null;
        plan_paid?: number | null;
        patient_responsibility?: number | null;
        confidence?: number | null;
      }
    | undefined;

  const caseUpdates: Record<string, unknown> = {
    last_extracted_at: new Date().toISOString(),
  };

  // Fetch current case to only fill null fields
  const { data: currentCase } = await supabase
    .from("billing_cases")
    .select("provider_name, payer_name, service_date_start, service_date_end, title, total_billed, total_allowed, total_plan_paid, total_patient_responsibility")
    .eq("id", caseId)
    .single();

  if (currentCase) {
    if (!currentCase.provider_name && extraction.provider_name) {
      caseUpdates.provider_name = extraction.provider_name;
    }
    if (!currentCase.payer_name && extraction.payer_name) {
      caseUpdates.payer_name = extraction.payer_name;
    }
    if (!currentCase.service_date_start && extraction.service_date_start) {
      caseUpdates.service_date_start = extraction.service_date_start;
    }
    if (!currentCase.service_date_end && extraction.service_date_end) {
      caseUpdates.service_date_end = extraction.service_date_end;
    }

    // Update totals from extraction
    if (totals) {
      if (totals.billed != null) caseUpdates.total_billed = totals.billed;
      if (totals.allowed != null) caseUpdates.total_allowed = totals.allowed;
      if (totals.plan_paid != null) caseUpdates.total_plan_paid = totals.plan_paid;
      if (totals.patient_responsibility != null) caseUpdates.total_patient_responsibility = totals.patient_responsibility;
      if (totals.confidence != null) caseUpdates.totals_confidence = totals.confidence;
    }

    // For freeform mode: replace placeholder title with AI-suggested title
    if (mode === "freeform" && extraction.suggested_title) {
      const isPlaceholder = currentCase.title?.startsWith("New Bill —") || currentCase.title?.startsWith("New Bill —");
      if (isPlaceholder) {
        caseUpdates.title = extraction.suggested_title;
      }
    }
  }

  await supabase
    .from("billing_cases")
    .update(caseUpdates)
    .eq("id", caseId);

  // ── Create billing_ledger_lines ──
  const sourceKey = documentId ?? caseId;

  // Totals line
  if (totals && (totals.billed != null || totals.patient_responsibility != null)) {
    await supabase
      .from("billing_ledger_lines")
      .upsert(
        {
          billing_case_id: caseId,
          billing_document_id: documentId,
          profile_id: profileId,
          household_id: householdId,
          line_kind: "total",
          description: mode === "freeform" ? "Freeform totals" : "Document totals",
          amount_billed: totals.billed ?? null,
          amount_allowed: totals.allowed ?? null,
          amount_plan_paid: totals.plan_paid ?? null,
          amount_patient: totals.patient_responsibility ?? null,
          confidence: totals.confidence ?? null,
          external_line_key: mode === "freeform"
            ? `${sourceKey}_freeform_totals`
            : `${sourceKey}_totals`,
        },
        { onConflict: "billing_case_id,external_line_key" },
      );
  }

  // Individual line items (document mode only)
  if (mode === "document") {
    const lineItems = (extraction.line_items ?? []) as Array<{
      description?: string;
      service_date?: string | null;
      procedure_code?: string | null;
      amount_billed?: number | null;
      amount_allowed?: number | null;
      amount_plan_paid?: number | null;
      amount_patient?: number | null;
      confidence?: number | null;
      evidence_snippet?: string | null;
    }>;

    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i];
      await supabase
        .from("billing_ledger_lines")
        .upsert(
          {
            billing_case_id: caseId,
            billing_document_id: documentId,
            profile_id: profileId,
            household_id: householdId,
            line_kind: "bill_line",
            description: item.description ?? null,
            service_date: item.service_date ?? null,
            procedure_code: item.procedure_code ?? null,
            amount_billed: item.amount_billed ?? null,
            amount_allowed: item.amount_allowed ?? null,
            amount_plan_paid: item.amount_plan_paid ?? null,
            amount_patient: item.amount_patient ?? null,
            confidence: item.confidence ?? null,
            evidence_snippet: item.evidence_snippet ?? null,
            external_line_key: `${sourceKey}_line_${i}`,
          },
          { onConflict: "billing_case_id,external_line_key" },
        );
    }
  }

  // ── Create billing_denial_records if denial detected ──
  if (extraction.denial_detected) {
    const denialInfo = extraction.denial_info as {
      category?: string | null;
      reason?: string | null;
      appeal_deadline?: string | null;
      confidence?: number | null;
      evidence_snippet?: string | null;
    } | null;

    if (denialInfo) {
      await supabase
        .from("billing_denial_records")
        .insert({
          billing_case_id: caseId,
          billing_document_id: documentId,
          profile_id: profileId,
          household_id: householdId,
          category: denialInfo.category ?? null,
          denial_reason: denialInfo.reason ?? null,
          deadline: denialInfo.appeal_deadline ?? null,
          confidence: denialInfo.confidence ?? null,
          evidence: denialInfo.evidence_snippet
            ? { snippet: denialInfo.evidence_snippet }
            : null,
        });
    }
  }

  // ── Upsert billing_case_parties if claim/member info extracted ──
  const claimNumber = extraction.claim_number as string | null;
  const memberId = extraction.member_id as string | null;
  const planName = extraction.plan_name as string | null;
  const groupNumber = extraction.group_number as string | null;

  if (claimNumber || memberId || planName || groupNumber) {
    // Check if parties row already exists for this case
    const { data: existingParties } = await supabase
      .from("billing_case_parties")
      .select("id, claim_number, member_id, plan_name, group_number")
      .eq("billing_case_id", caseId)
      .limit(1)
      .maybeSingle();

    if (existingParties) {
      // Update only null fields
      const partyUpdates: Record<string, unknown> = {};
      if (!existingParties.claim_number && claimNumber) partyUpdates.claim_number = claimNumber;
      if (!existingParties.member_id && memberId) partyUpdates.member_id = memberId;
      if (!existingParties.plan_name && planName) partyUpdates.plan_name = planName;
      if (!existingParties.group_number && groupNumber) partyUpdates.group_number = groupNumber;

      if (Object.keys(partyUpdates).length > 0) {
        await supabase
          .from("billing_case_parties")
          .update(partyUpdates)
          .eq("id", existingParties.id);
      }
    } else {
      await supabase
        .from("billing_case_parties")
        .insert({
          billing_case_id: caseId,
          profile_id: profileId,
          household_id: householdId,
          claim_number: claimNumber,
          member_id: memberId,
          plan_name: planName,
          group_number: groupNumber,
        });
    }
  }

  // ── Mark job as completed ──
  await supabase
    .from("billing_extract_jobs")
    .update({
      status: "completed",
      result_json: extraction,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

async function markJobFailed(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  errorMessage: string,
) {
  logError("extract-billing.job_failed", undefined, { jobId, errorMessage });
  await supabase
    .from("billing_extract_jobs")
    .update({
      status: "failed",
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

// ── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { mode, caseId, profileId, householdId } = body;

    if (!mode || !caseId || !profileId || !householdId) {
      return jsonResponse(
        { error: "mode, caseId, profileId, and householdId are required" },
        400,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ════════════════════════════════════════════════════════════════════
    // DOCUMENT MODE
    // ════════════════════════════════════════════════════════════════════
    if (mode === "document") {
      const { documentId } = body;
      if (!documentId) {
        return jsonResponse({ error: "documentId is required for document mode" }, 400);
      }

      // 1. Fetch billing document
      const { data: doc, error: docError } = await supabase
        .from("billing_documents")
        .select("*")
        .eq("id", documentId)
        .single();

      if (docError || !doc) {
        return jsonResponse({ error: "Billing document not found" }, 404);
      }

      // 2. Create extract job
      const { data: job, error: jobError } = await supabase
        .from("billing_extract_jobs")
        .insert({
          billing_case_id: caseId,
          billing_document_id: documentId,
          profile_id: profileId,
          household_id: householdId,
          status: "processing",
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (jobError || !job) {
        return jsonResponse({ error: "Failed to create extraction job" }, 500);
      }

      const jobId = job.id;

      // 3. Download file from storage
      const { data: urlData, error: urlError } = await supabase.storage
        .from("billing-documents")
        .createSignedUrl(doc.file_path, 600);

      if (urlError || !urlData?.signedUrl) {
        await markJobFailed(supabase, jobId, "Could not generate signed URL");
        return jsonResponse({ error: "Could not access document file" }, 500);
      }

      const mimeType = doc.mime_type || "image/jpeg";
      const supportedImageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      const isImage = supportedImageTypes.includes(mimeType);
      const isPdf = mimeType === "application/pdf";

      if (!isImage && !isPdf) {
        await markJobFailed(supabase, jobId, `Unsupported file type: ${mimeType}`);
        return jsonResponse({ error: `Unsupported file type: ${mimeType}` }, 400);
      }

      const MAX_FILE_SIZE = 20 * 1024 * 1024;

      const fileResponse = await fetch(urlData.signedUrl);
      if (!fileResponse.ok) {
        await markJobFailed(supabase, jobId, "Could not download document file");
        return jsonResponse({ error: "Could not download document file" }, 500);
      }

      const fileBuffer = await fileResponse.arrayBuffer();
      if (fileBuffer.byteLength > MAX_FILE_SIZE) {
        await markJobFailed(supabase, jobId, `File too large: ${fileBuffer.byteLength} bytes`);
        return jsonResponse({ error: "File too large. Maximum size is 20 MB." }, 413);
      }

      const base64Data = btoa(
        new Uint8Array(fileBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
      );

      let contentBlock: Record<string, unknown>;
      if (isPdf) {
        contentBlock = {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64Data },
        };
      } else {
        contentBlock = {
          type: "image",
          source: { type: "base64", media_type: mimeType, data: base64Data },
        };
      }

      const userPrompt = isPdf
        ? "Extract all structured billing data from this document. Return JSON only."
        : "Extract all structured billing data from this document image. Return JSON only.";

      // 4. Call Claude
      const claudeResult = await callClaude(anthropicApiKey, DOCUMENT_EXTRACTION_PROMPT, [
        {
          role: "user",
          content: [contentBlock, { type: "text", text: userPrompt }],
        },
      ]);

      if ("error" in claudeResult) {
        await markJobFailed(supabase, jobId, claudeResult.error);
        return jsonResponse({ error: "AI extraction failed" }, claudeResult.status);
      }

      // 5. Parse response
      const extraction = parseExtractionJson(claudeResult.text);
      if (!extraction) {
        await markJobFailed(supabase, jobId, "Could not parse extraction JSON");
        return jsonResponse({ error: "AI returned invalid JSON" }, 502);
      }

      // 6. Store results
      await storeExtractionResults({
        supabase,
        extraction,
        caseId,
        profileId,
        householdId,
        documentId,
        jobId,
        mode: "document",
      });

      return jsonResponse({ jobId, status: "completed" });
    }

    // ════════════════════════════════════════════════════════════════════
    // FREEFORM MODE
    // ════════════════════════════════════════════════════════════════════
    if (mode === "freeform") {
      const { text } = body;
      if (!text || !text.trim()) {
        return jsonResponse({ error: "text is required for freeform mode" }, 400);
      }

      // 1. Create extract job (no document)
      const { data: job, error: jobError } = await supabase
        .from("billing_extract_jobs")
        .insert({
          billing_case_id: caseId,
          billing_document_id: null,
          profile_id: profileId,
          household_id: householdId,
          status: "processing",
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (jobError || !job) {
        return jsonResponse({ error: "Failed to create extraction job" }, 500);
      }

      const jobId = job.id;

      // 2. Call Claude
      const claudeResult = await callClaude(anthropicApiKey, FREEFORM_EXTRACTION_PROMPT, [
        {
          role: "user",
          content: `Extract billing information from the following patient description:\n\n---\n${text.trim()}\n---`,
        },
      ]);

      if ("error" in claudeResult) {
        await markJobFailed(supabase, jobId, claudeResult.error);
        return jsonResponse({ error: "AI extraction failed" }, claudeResult.status);
      }

      // 3. Parse response
      const extraction = parseExtractionJson(claudeResult.text);
      if (!extraction) {
        await markJobFailed(supabase, jobId, "Could not parse extraction JSON");
        return jsonResponse({ error: "AI returned invalid JSON" }, 502);
      }

      // 4. Store results
      await storeExtractionResults({
        supabase,
        extraction,
        caseId,
        profileId,
        householdId,
        documentId: null,
        jobId,
        mode: "freeform",
      });

      return jsonResponse({ jobId, status: "completed" });
    }

    return jsonResponse({ error: `Unknown mode: ${mode}` }, 400);
  } catch (err) {
    logError("extract-billing.unhandled", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
