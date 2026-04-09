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
- Assign a confidence score (0.0–1.0) to each field based on how clearly you can read/interpret it.
- If you cannot read a value clearly, still include it with a lower confidence score.
- Never fabricate data. If something is not present in the document, do not include it.

CRITICAL — CONTEXT-AWARE CATEGORIZATION:
You MUST understand the user's INTENT, not just the words. Categorize based on what the user MEANS, not surface-level keyword matching.

- If someone says "I'm allergic to X", "X causes Y side effect", "I had a bad reaction to X", or "I can't take X because it gives me Y" → that is an ALLERGY, not a medication. Use field_key "allergy.entry" with value {"substance": "X", "reaction": "Y"}.
- If someone describes a medication they are CURRENTLY TAKING with a dose and frequency → that is a MEDICATION. Use field_key "medication.entry".
- If someone says "I was diagnosed with X" or "I have X" → that is a CONDITION. Use field_key "condition.entry".
- If someone describes a past surgery or procedure → that is a SURGERY. Use field_key "surgery.entry".
- A drug name alone does NOT mean it's a current medication. Context matters: "lisinopril gives me a cough" = allergy. "I take lisinopril 10mg daily" = medication.

CRITICAL — STRUCTURED ENTRIES (ONE ITEM PER LOGICAL FACT):
Each extracted field must represent ONE complete, meaningful fact — NOT fragments.

DO NOT create separate entries for each sub-field of a single logical item.
DO create ONE entry with a structured object value containing all related sub-fields.

WRONG (fragmented):
  {"field_key": "medication.name", "value": "lisinopril"}
  {"field_key": "medication.dose", "value": "25mg"}
  {"field_key": "medication.frequency", "value": "once daily"}

CORRECT (one structured entry):
  {"field_key": "medication.entry", "value": {"drug_name": "lisinopril", "dose": "25mg", "frequency": "once daily"}}

WRONG (fragmented insurance):
  {"field_key": "insurance.payer_name", "value": "Blue Cross"}
  {"field_key": "insurance.member_id", "value": "XAD841976918"}
  {"field_key": "insurance.group_number", "value": "82112"}

CORRECT (one structured entry):
  {"field_key": "insurance.entry", "value": {"payer_name": "Blue Cross", "member_id": "XAD841976918", "group_number": "82112"}}

ENTRY STRUCTURES BY CATEGORY:

medication.entry → {"drug_name", "generic_name", "dose", "frequency", "quantity", "refills_remaining", "prescriber", "pharmacy_name", "pharmacy_phone", "rx_number", "date_filled", "expiration_date", "instructions"}
  Only include sub-fields that are present in the source.

allergy.entry → {"substance", "reaction", "severity"}
  substance = the allergen (drug, food, environmental)
  reaction = what happens (rash, cough, anaphylaxis, etc.)
  severity = mild/moderate/severe if mentioned

condition.entry → {"name", "status", "diagnosed_date", "notes"}

insurance.entry → {"payer_name", "member_id", "group_number", "rx_bin", "rx_pcn", "plan_type", "phone_member_services", "phone_provider", "copay_primary", "copay_specialist", "copay_emergency", "deductible"}

care_team.entry → {"name", "specialty", "phone", "address", "fax", "notes"}

pharmacy.entry → {"name", "phone", "address"}

surgery.entry → {"name", "date", "hospital", "surgeon", "notes"}

family_history.entry → {"condition", "relative", "notes"}

emergency_contact.entry → {"name", "relationship", "phone"}

lab.entry → {"test_name", "result_value", "units", "reference_range", "status", "date_collected", "date_reported", "ordering_provider", "performing_lab"}

If multiple items exist in the same category (e.g., 3 medications), create 3 separate "medication.entry" fields — one per medication.

DOCUMENT TYPES:
insurance_card, medication_bottle, lab_result, discharge_summary, bill_eob, prescription, voice_note, general

For voice_note and general types: extract whatever structured healthcare data is present using the entry structures above. Pay close attention to conversational context to determine the correct category.

RESPONSE FORMAT:
{
  "document_type": "<one of the types above>",
  "confidence": <0.0-1.0 overall document classification confidence>,
  "fields": [
    {
      "field_key": "category.entry",
      "value": { <structured object with relevant sub-fields> },
      "confidence": <0.0-1.0>,
      "evidence": "<brief note about where/how this was found>"
    }
  ]
}

IMPORTANT: Do NOT include suggested_tasks in your response. Only return extracted data fields. Task generation is handled separately by the commit engine.`;

// ── Field-key to intent item type mapping ───────────────────────────────────

function getItemType(fieldKey: string): string {
  const category = fieldKey.split(".")[0];
  switch (category) {
    case "medication":
      return "medication";
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
