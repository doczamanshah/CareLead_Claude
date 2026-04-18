// Deploy with:
// supabase functions deploy extract-result --no-verify-jwt --project-ref ccpxoidlqsolzypmkiul
//
// Requires ANTHROPIC_API_KEY set as a Supabase Edge Function secret
// (should already be set from the extract-document function).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const BUCKET = "result-documents";
const MAX_FILE_SIZE = 20 * 1024 * 1024;

type ResultType = "lab" | "imaging" | "other";

// ── Extraction prompts ────────────────────────────────────────────────────

const LAB_EXTRACTION_PROMPT = `You are a medical lab result extraction assistant. Extract structured data from this lab report. You are extracting what the report says, NOT interpreting results or giving medical advice.

Return ONLY valid JSON with this exact structure:
{
  "suggested_test_name": string (a concise name for this lab panel, e.g., "Comprehensive Metabolic Panel", "Complete Blood Count", "Lipid Panel"),
  "performed_date": "YYYY-MM-DD" or null,
  "reported_date": "YYYY-MM-DD" or null,
  "facility": string or null,
  "ordering_clinician": string or null,
  "analytes": [
    {
      "name": string (e.g., "Glucose", "Hemoglobin A1c", "LDL Cholesterol"),
      "value": string (the value exactly as written, e.g., "95", "6.8", ">10.0", "Negative"),
      "numeric_value": number or null (parsed numeric, null if non-numeric like "Negative"),
      "unit": string or null (e.g., "mg/dL", "%", "mIU/L"),
      "ref_range_low": number or null,
      "ref_range_high": number or null,
      "ref_range_text": string or null (original range as written, e.g., "70-100"),
      "flag": "normal" | "high" | "low" | "abnormal" | "critical" | null,
      "confidence": number between 0 and 1
    }
  ],
  "overall_confidence": number between 0 and 1,
  "notes": string or null (any additional relevant text not captured in analytes)
}

Extract ONLY what is explicitly present. Do not infer or calculate flags unless explicitly stated in the report. Set fields to null if not found. Return valid JSON only, no markdown, no explanation.`;

const IMAGING_EXTRACTION_PROMPT = `You are a medical imaging report extraction assistant. Extract structured data from this imaging/radiology report. You are extracting what the report says, NOT interpreting results or giving medical advice.

Return ONLY valid JSON with this exact structure:
{
  "suggested_test_name": string (e.g., "CT Abdomen and Pelvis with Contrast", "Chest X-Ray PA and Lateral"),
  "modality": string or null (e.g., "CT", "MRI", "X-Ray", "Ultrasound", "PET"),
  "body_part": string or null (e.g., "Abdomen", "Chest", "Brain", "Knee"),
  "performed_date": "YYYY-MM-DD" or null,
  "reported_date": "YYYY-MM-DD" or null,
  "facility": string or null,
  "ordering_clinician": string or null,
  "radiologist": string or null,
  "findings": string or null (the Findings section of the report, preserved as written),
  "impression": string or null (the Impression/Conclusion section, preserved as written),
  "comparison": string or null (any comparison/prior study reference),
  "technique": string or null (technique/protocol used),
  "overall_confidence": number between 0 and 1,
  "notes": string or null
}

Extract ONLY what is explicitly present. Preserve the findings and impression text as written in the report. Return valid JSON only, no markdown, no explanation.`;

const OTHER_EXTRACTION_PROMPT = `You are a medical test result extraction assistant. Extract structured data from this test report (EKG, PFT, sleep study, pathology, genetic testing, etc.). You are extracting what the report says, NOT interpreting or giving medical advice.

Return ONLY valid JSON with this exact structure:
{
  "suggested_test_name": string,
  "test_category": string or null (e.g., "Cardiology", "Pulmonology", "Pathology", "Genetics"),
  "performed_date": "YYYY-MM-DD" or null,
  "reported_date": "YYYY-MM-DD" or null,
  "facility": string or null,
  "ordering_clinician": string or null,
  "reporting_clinician": string or null,
  "summary": string or null (the main conclusion or impression),
  "key_findings": [
    {
      "label": string,
      "value": string,
      "confidence": number between 0 and 1
    }
  ],
  "overall_confidence": number between 0 and 1,
  "notes": string or null
}

Extract ONLY what is explicitly present. Return valid JSON only, no markdown, no explanation.`;

function promptForType(resultType: ResultType): string {
  switch (resultType) {
    case "lab":
      return LAB_EXTRACTION_PROMPT;
    case "imaging":
      return IMAGING_EXTRACTION_PROMPT;
    case "other":
      return OTHER_EXTRACTION_PROMPT;
  }
}

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
    const errBody = await resp.text();
    console.error("Claude API error:", resp.status, errBody);
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

async function markJobFailed(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  errorMessage: string,
) {
  console.error(`Result extraction job ${jobId} failed: ${errorMessage}`);
  await supabase
    .from("result_extract_jobs")
    .update({
      status: "failed",
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

// ── Store extraction results ───────────────────────────────────────────────

interface StoreResultsParams {
  supabase: ReturnType<typeof createClient>;
  extraction: Record<string, unknown>;
  resultId: string;
  profileId: string;
  householdId: string;
  resultType: ResultType;
  jobId: string;
}

function buildPerFieldConfidence(
  extraction: Record<string, unknown>,
  resultType: ResultType,
): Record<string, number> {
  const perField: Record<string, number> = {};
  if (resultType === "lab") {
    const analytes = (extraction.analytes ?? []) as Array<{
      name?: string;
      confidence?: number | null;
    }>;
    for (const a of analytes) {
      if (a.name && typeof a.confidence === "number") {
        perField[a.name] = a.confidence;
      }
    }
  } else if (resultType === "other") {
    const findings = (extraction.key_findings ?? []) as Array<{
      label?: string;
      confidence?: number | null;
    }>;
    for (const f of findings) {
      if (f.label && typeof f.confidence === "number") {
        perField[f.label] = f.confidence;
      }
    }
  }
  return perField;
}

async function storeExtractionResults(params: StoreResultsParams) {
  const { supabase, extraction, resultId, profileId, householdId, resultType, jobId } =
    params;

  // Fetch current result to decide which fields to backfill
  const { data: current } = await supabase
    .from("result_items")
    .select("test_name, performed_at, reported_at, facility, ordering_clinician")
    .eq("id", resultId)
    .single();

  const overallConfidence =
    typeof extraction.overall_confidence === "number"
      ? (extraction.overall_confidence as number)
      : null;

  const suggestedTestName =
    typeof extraction.suggested_test_name === "string"
      ? (extraction.suggested_test_name as string).trim()
      : null;

  const performedDate =
    typeof extraction.performed_date === "string"
      ? (extraction.performed_date as string)
      : null;

  const reportedDate =
    typeof extraction.reported_date === "string"
      ? (extraction.reported_date as string)
      : null;

  const facility =
    typeof extraction.facility === "string"
      ? (extraction.facility as string)
      : null;

  const orderingClinician =
    typeof extraction.ordering_clinician === "string"
      ? (extraction.ordering_clinician as string)
      : null;

  const itemUpdates: Record<string, unknown> = {
    structured_data: extraction,
    field_confidence: {
      overall: overallConfidence,
      per_field: buildPerFieldConfidence(extraction, resultType),
    },
    status: overallConfidence !== null && overallConfidence < 0.7 ? "needs_review" : "ready",
  };

  if (current) {
    const titleIsPlaceholder =
      typeof current.test_name === "string" &&
      current.test_name.startsWith("New Result —");
    if (titleIsPlaceholder && suggestedTestName) {
      itemUpdates.test_name = suggestedTestName;
    }
    if (!current.performed_at && performedDate) {
      itemUpdates.performed_at = performedDate;
    }
    if (!current.reported_at && reportedDate) {
      itemUpdates.reported_at = reportedDate;
    }
    if (!current.facility && facility) {
      itemUpdates.facility = facility;
    }
    if (!current.ordering_clinician && orderingClinician) {
      itemUpdates.ordering_clinician = orderingClinician;
    }
  }

  await supabase.from("result_items").update(itemUpdates).eq("id", resultId);

  // Lab observations — only for lab results
  if (resultType === "lab") {
    const analytes = (extraction.analytes ?? []) as Array<{
      name?: string;
      value?: string | null;
      numeric_value?: number | null;
      unit?: string | null;
      ref_range_low?: number | null;
      ref_range_high?: number | null;
      ref_range_text?: string | null;
      flag?: string | null;
      confidence?: number | null;
    }>;

    const observedAt =
      performedDate ?? new Date().toISOString().slice(0, 10);

    for (const a of analytes) {
      if (!a.name) continue;
      if (a.numeric_value == null) continue;

      const flag =
        a.flag &&
        ["normal", "high", "low", "abnormal", "critical"].includes(a.flag)
          ? a.flag
          : null;

      await supabase
        .from("result_lab_observations")
        .upsert(
          {
            result_id: resultId,
            profile_id: profileId,
            household_id: householdId,
            analyte_name: a.name,
            numeric_value: a.numeric_value,
            value_text: a.value ?? null,
            unit: a.unit ?? null,
            ref_range_low: a.ref_range_low ?? null,
            ref_range_high: a.ref_range_high ?? null,
            ref_range_text: a.ref_range_text ?? null,
            flag,
            observed_at: observedAt,
            confidence: a.confidence ?? null,
            source: "extracted",
          },
          { onConflict: "result_id,analyte_name" },
        );
    }
  }

  await supabase
    .from("result_extract_jobs")
    .update({
      status: "completed",
      result_json: extraction,
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
    const { resultId, profileId, householdId, resultType, rawText, documentId } =
      body as {
        resultId?: string;
        profileId?: string;
        householdId?: string;
        resultType?: ResultType;
        rawText?: string | null;
        documentId?: string | null;
      };

    if (!resultId || !profileId || !householdId || !resultType) {
      return jsonResponse(
        {
          error:
            "resultId, profileId, householdId, and resultType are required",
        },
        400,
      );
    }

    if (!["lab", "imaging", "other"].includes(resultType)) {
      return jsonResponse({ error: `Invalid resultType: ${resultType}` }, 400);
    }

    if (!rawText && !documentId) {
      return jsonResponse(
        { error: "Either rawText or documentId must be provided" },
        400,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Create extract job
    const { data: job, error: jobError } = await supabase
      .from("result_extract_jobs")
      .insert({
        result_id: resultId,
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

    const jobId = job.id as string;

    // 2. Mark result as processing
    await supabase
      .from("result_items")
      .update({ status: "processing" })
      .eq("id", resultId);

    // 3. Build user message content
    const systemPrompt = promptForType(resultType);
    let userMessageContent: unknown;

    if (documentId) {
      // Document mode — download and send as image/PDF
      const { data: doc, error: docError } = await supabase
        .from("result_documents")
        .select("file_path, mime_type")
        .eq("id", documentId)
        .single();

      if (docError || !doc) {
        await markJobFailed(supabase, jobId, "Result document not found");
        return jsonResponse({ error: "Result document not found" }, 404);
      }

      const { data: urlData, error: urlError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(doc.file_path, 600);

      if (urlError || !urlData?.signedUrl) {
        await markJobFailed(supabase, jobId, "Could not generate signed URL");
        return jsonResponse({ error: "Could not access document file" }, 500);
      }

      const mimeType = doc.mime_type || "image/jpeg";
      const supportedImageTypes = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ];
      const isImage = supportedImageTypes.includes(mimeType);
      const isPdf = mimeType === "application/pdf";

      if (!isImage && !isPdf) {
        await markJobFailed(supabase, jobId, `Unsupported file type: ${mimeType}`);
        return jsonResponse(
          { error: `Unsupported file type: ${mimeType}` },
          400,
        );
      }

      const fileResponse = await fetch(urlData.signedUrl);
      if (!fileResponse.ok) {
        await markJobFailed(supabase, jobId, "Could not download document file");
        return jsonResponse({ error: "Could not download document file" }, 500);
      }

      const fileBuffer = await fileResponse.arrayBuffer();
      if (fileBuffer.byteLength > MAX_FILE_SIZE) {
        await markJobFailed(
          supabase,
          jobId,
          `File too large: ${fileBuffer.byteLength} bytes`,
        );
        return jsonResponse(
          { error: "File too large. Maximum size is 20 MB." },
          413,
        );
      }

      const base64Data = btoa(
        new Uint8Array(fileBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          "",
        ),
      );

      const contentBlock: Record<string, unknown> = isPdf
        ? {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64Data,
            },
          }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: base64Data,
            },
          };

      const userPrompt = isPdf
        ? "Extract all structured data from this report. Return JSON only."
        : "Extract all structured data from this report image. Return JSON only.";

      userMessageContent = [contentBlock, { type: "text", text: userPrompt }];
    } else {
      // Text mode
      userMessageContent = `Extract structured data from the following report text:\n\n---\n${rawText!.trim()}\n---`;
    }

    // 4. Call Claude
    const claudeResult = await callClaude(anthropicApiKey, systemPrompt, [
      { role: "user", content: userMessageContent },
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
      resultId,
      profileId,
      householdId,
      resultType,
      jobId,
    });

    return jsonResponse({ jobId, status: "completed" });
  } catch (err) {
    console.error("Unhandled error in extract-result:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
