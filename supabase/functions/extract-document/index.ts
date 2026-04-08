import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// ── Extraction prompt ───────────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a healthcare document data extraction system for CareLead, a patient-owned care operations platform.

Your job is to analyze healthcare documents (images, scans, PDFs, or text notes/dictations) and extract structured data.

RULES:
- Return ONLY valid JSON, no markdown fences, no commentary.
- Identify the document type first, then extract every relevant field.
- Text input may come from voice dictation and could be informal, conversational, or contain speech-to-text errors. Interpret intent generously.
- Assign a confidence score (0.0–1.0) to each field based on how clearly you can read it.
- Use the field_key naming convention: "category.field_name" (e.g., "insurance.payer_name").
- If you cannot read a value clearly, still include it with a lower confidence score.
- Never fabricate data. If something is not present in the image, do not include it.

DOCUMENT TYPES AND EXPECTED FIELDS:

insurance_card:
  insurance.payer_name, insurance.member_id, insurance.group_number,
  insurance.rx_bin, insurance.rx_pcn, insurance.plan_type,
  insurance.phone_member_services, insurance.phone_provider,
  insurance.copay_primary, insurance.copay_specialist,
  insurance.copay_emergency, insurance.deductible

medication_bottle:
  medication.name, medication.generic_name, medication.dose,
  medication.frequency, medication.quantity, medication.refills_remaining,
  medication.prescriber, medication.pharmacy_name, medication.pharmacy_phone,
  medication.rx_number, medication.date_filled, medication.expiration_date,
  medication.instructions

lab_result:
  lab.test_name, lab.result_value, lab.units, lab.reference_range,
  lab.status, lab.date_collected, lab.date_reported,
  lab.ordering_provider, lab.performing_lab

discharge_summary:
  discharge.diagnoses, discharge.procedures, discharge.medications_at_discharge,
  discharge.follow_up_appointments, discharge.instructions,
  discharge.restrictions, discharge.admitting_provider,
  discharge.discharge_date, discharge.admission_date

bill_eob:
  billing.provider_name, billing.service_date, billing.billed_amount,
  billing.insurance_paid, billing.patient_owes, billing.claim_number,
  billing.account_number, billing.due_date, billing.service_description

prescription:
  medication.name, medication.dose, medication.frequency,
  medication.quantity, medication.refills, medication.prescriber,
  medication.date_written, medication.instructions

general:
  Extract whatever structured healthcare data is present using appropriate
  category.field_name keys.

RESPONSE FORMAT:
{
  "document_type": "<one of the types above>",
  "confidence": <0.0-1.0 overall document classification confidence>,
  "fields": [
    {
      "field_key": "category.field_name",
      "value": "<extracted value>",
      "confidence": <0.0-1.0>,
      "evidence": "<brief note about where in the document this was found>"
    }
  ]
}`;

// ── Field-key to intent item type mapping ───────────────────────────────────

function getItemType(fieldKey: string): string {
  const category = fieldKey.split(".")[0];
  switch (category) {
    case "medication":
      return "medication";
    case "lab":
    case "discharge":
    case "billing":
      return "profile_fact";
    case "insurance":
    case "care_team":
    case "pharmacy":
    case "allergy":
    case "condition":
    case "surgery":
    case "family_history":
    case "emergency_contact":
      return "profile_fact";
    default:
      return "profile_fact";
  }
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { artifactId, profileId } = await req.json();

    if (!artifactId || !profileId) {
      return new Response(
        JSON.stringify({ error: "artifactId and profileId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Use service role to bypass RLS — Edge Functions are trusted server-side code
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── 1. Mark artifact as processing ────────────────────────────────────
    const { data: artifact, error: artifactError } = await supabase
      .from("artifacts")
      .update({ processing_status: "processing" })
      .eq("id", artifactId)
      .eq("profile_id", profileId)
      .select()
      .single();

    if (artifactError || !artifact) {
      return new Response(
        JSON.stringify({ error: "Artifact not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 2. Determine if this is a text-based artifact ───────────────────
    const hasText = !!(artifact.ocr_text && artifact.ocr_text.trim());
    const isTextArtifact =
      hasText ||
      artifact.artifact_type === "note" ||
      artifact.mime_type === "text/plain";

    // ── 3. Build Claude API messages based on artifact type ──────────────
    let claudeMessages: Array<{ role: string; content: unknown }>;

    if (isTextArtifact) {
      // ── Text path: extract from ocr_text directly ───────────────────
      const textContent = artifact.ocr_text?.trim();
      if (!textContent) {
        await markFailed(supabase, artifactId, "Text artifact has no content");
        return new Response(
          JSON.stringify({ error: "No text content to extract from" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      claudeMessages = [
        {
          role: "user",
          content: `Extract all structured healthcare data from the following text. The text may be a voice dictation or typed note — it could be informal or conversational. Return JSON only.\n\n---\n${textContent}\n---`,
        },
      ];
    } else {
      // ── File path: download and send image/PDF to Claude ────────────
      const { data: urlData, error: urlError } = await supabase.storage
        .from("artifacts")
        .createSignedUrl(artifact.file_path, 600); // 10 min expiry

      if (urlError || !urlData?.signedUrl) {
        await markFailed(supabase, artifactId, "Could not generate signed URL");
        return new Response(
          JSON.stringify({ error: "Could not access artifact file" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const mimeType = artifact.mime_type || "image/jpeg";
      const supportedImageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      const isImage = supportedImageTypes.includes(mimeType);
      const isPdf = mimeType === "application/pdf";
      const isHeic = mimeType === "image/heic" || mimeType === "image/heif";

      if (isHeic) {
        await markFailed(supabase, artifactId, "HEIC/HEIF format is not supported");
        return new Response(
          JSON.stringify({
            error: "HEIC/HEIF format is not supported. Please upload a JPEG or PNG image instead.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (!isImage && !isPdf) {
        await markFailed(supabase, artifactId, `Unsupported file type: ${mimeType}`);
        return new Response(
          JSON.stringify({ error: `Unsupported file type: ${mimeType}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB limit

      const fileResponse = await fetch(urlData.signedUrl);
      if (!fileResponse.ok) {
        await markFailed(supabase, artifactId, "Could not download artifact file");
        return new Response(
          JSON.stringify({ error: "Could not download artifact file" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const contentLength = fileResponse.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
        await markFailed(supabase, artifactId, `File too large: ${contentLength} bytes`);
        return new Response(
          JSON.stringify({ error: "File too large. Maximum size is 20 MB." }),
          { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const fileBuffer = await fileResponse.arrayBuffer();
      if (fileBuffer.byteLength > MAX_FILE_SIZE) {
        await markFailed(supabase, artifactId, `File too large: ${fileBuffer.byteLength} bytes`);
        return new Response(
          JSON.stringify({ error: "File too large. Maximum size is 20 MB." }),
          { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
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
        ? "Extract all structured healthcare data from this document. Return JSON only."
        : "Extract all structured healthcare data from this document image. Return JSON only.";

      claudeMessages = [
        {
          role: "user",
          content: [
            contentBlock,
            { type: "text", text: userPrompt },
          ],
        },
      ];
    }

    // ── 4. Call Claude API for extraction ──────────────────────────────────
    const claudeResponse = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: claudeMessages,
      }),
    });

    if (!claudeResponse.ok) {
      const errBody = await claudeResponse.text();
      console.error("Claude API error:", claudeResponse.status, errBody);
      await markFailed(supabase, artifactId, `Claude API error: ${claudeResponse.status}`);
      return new Response(
        JSON.stringify({ error: "AI extraction failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const claudeResult = await claudeResponse.json();

    // ── 5. Parse Claude response ─────────────────────────────────────────
    const textBlock = claudeResult.content?.find(
      (block: { type: string }) => block.type === "text",
    );
    if (!textBlock?.text) {
      await markFailed(supabase, artifactId, "Empty response from Claude API");
      return new Response(
        JSON.stringify({ error: "AI returned empty response" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Parse the extraction JSON — strip markdown fences if present
    let extraction;
    try {
      const cleanJson = textBlock.text
        .replace(/^```json?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      extraction = JSON.parse(cleanJson);
    } catch {
      await markFailed(supabase, artifactId, "Could not parse extraction JSON");
      return new Response(
        JSON.stringify({ error: "AI returned invalid JSON" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const documentType: string = extraction.document_type || "general";
    const fields: Array<{
      field_key: string;
      value: unknown;
      confidence: number;
      evidence?: string;
    }> = extraction.fields || [];

    if (fields.length === 0) {
      await supabase
        .from("artifacts")
        .update({
          processing_status: "completed",
          classification: documentType,
        })
        .eq("id", artifactId);

      return new Response(
        JSON.stringify({ message: "No fields extracted", intentSheetId: null, documentType, fieldCount: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 6. Store extracted fields ─────────────────────────────────────────
    const extractedFieldRows = fields.map((f) => ({
      artifact_id: artifactId,
      profile_id: profileId,
      field_key: f.field_key,
      value_json: typeof f.value === "object" ? f.value : { value: f.value },
      confidence: Math.min(Math.max(f.confidence, 0), 1),
      evidence_json: f.evidence ? { description: f.evidence } : null,
      status: "unreviewed",
    }));

    const { error: fieldsError } = await supabase
      .from("extracted_fields")
      .insert(extractedFieldRows);

    if (fieldsError) {
      console.error("Error inserting extracted fields:", fieldsError);
      await markFailed(supabase, artifactId, "Failed to store extracted fields");
      return new Response(
        JSON.stringify({ error: "Failed to store extraction results" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 7. Create intent sheet ────────────────────────────────────────────
    const { data: intentSheet, error: sheetError } = await supabase
      .from("intent_sheets")
      .insert({
        profile_id: profileId,
        artifact_id: artifactId,
        source_type: "extraction",
        status: "pending_review",
      })
      .select()
      .single();

    if (sheetError || !intentSheet) {
      console.error("Error creating intent sheet:", sheetError);
      await markFailed(supabase, artifactId, "Failed to create intent sheet");
      return new Response(
        JSON.stringify({ error: "Failed to create review sheet" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 8. Create intent items from extracted fields ─────────────────────
    const intentItemRows = fields.map((f) => ({
      intent_sheet_id: intentSheet.id,
      profile_id: profileId,
      item_type: getItemType(f.field_key),
      field_key: f.field_key,
      proposed_value: typeof f.value === "object" ? f.value : { value: f.value },
      confidence: Math.min(Math.max(f.confidence, 0), 1),
      evidence_json: f.evidence ? { description: f.evidence } : null,
      status: "pending",
    }));

    const { error: itemsError } = await supabase
      .from("intent_items")
      .insert(intentItemRows);

    if (itemsError) {
      console.error("Error creating intent items:", itemsError);
      // Intent sheet exists but items failed — still update artifact as completed
      // so user can see something happened
    }

    // ── 9. Update artifact as completed ──────────────────────────────────
    await supabase
      .from("artifacts")
      .update({
        processing_status: "completed",
        classification: documentType,
      })
      .eq("id", artifactId);

    // ── 10. Return the intent sheet ID ────────────────────────────────────
    return new Response(
      JSON.stringify({
        intentSheetId: intentSheet.id,
        documentType,
        fieldCount: fields.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Unhandled error in extract-document:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ── Helper: mark artifact as failed ─────────────────────────────────────────

async function markFailed(
  supabase: ReturnType<typeof createClient>,
  artifactId: string,
  reason: string,
) {
  console.error(`Extraction failed for artifact ${artifactId}: ${reason}`);
  await supabase
    .from("artifacts")
    .update({ processing_status: "failed" })
    .eq("id", artifactId);
}
