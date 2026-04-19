import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const MED_LABEL_SYSTEM_PROMPT = `You are a medication label extraction assistant. Extract medication information from this photo of a medication bottle, prescription label, or pharmacy printout.

Return ONLY valid JSON, no markdown fences, no commentary:
{
  "medication_name": string or null,
  "generic_name": string or null,
  "brand_name": string or null,
  "dose": string or null,
  "form": string or null,
  "frequency": string or null,
  "quantity": number or null,
  "refills_remaining": number or null,
  "prescriber": string or null,
  "pharmacy_name": string or null,
  "pharmacy_phone": string or null,
  "rx_number": string or null,
  "last_fill_date": "YYYY-MM-DD" or null,
  "expiration_date": "YYYY-MM-DD" or null,
  "instructions": string or null,
  "confidence": number between 0 and 1
}

Extract ONLY what is explicitly visible on the label. Do not guess or invent values. Return valid JSON only, no markdown.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { artifactId, profileId } = await req.json();

    if (!artifactId || !profileId) {
      return json({ error: "artifactId and profileId are required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    const { data: artifact, error: artifactError } = await supabase
      .from("artifacts")
      .update({ processing_status: "processing" })
      .eq("id", artifactId)
      .eq("profile_id", profileId)
      .select()
      .single();

    if (artifactError || !artifact) {
      return json({ error: "Artifact not found or access denied" }, 404);
    }

    const { data: urlData, error: urlError } = await supabase.storage
      .from("artifacts")
      .createSignedUrl(artifact.file_path, 600);

    if (urlError || !urlData?.signedUrl) {
      await markFailed(supabase, artifactId);
      return json({ error: "Could not access artifact file" }, 500);
    }

    const mimeType = artifact.mime_type || "image/jpeg";
    const supportedImageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

    if (!supportedImageTypes.includes(mimeType)) {
      await markFailed(supabase, artifactId);
      return json({ error: `Unsupported file type: ${mimeType}` }, 400);
    }

    const fileResponse = await fetch(urlData.signedUrl);
    if (!fileResponse.ok) {
      await markFailed(supabase, artifactId);
      return json({ error: "Could not download file" }, 500);
    }

    const fileBuffer = await fileResponse.arrayBuffer();
    const base64Data = btoa(
      new Uint8Array(fileBuffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        "",
      ),
    );

    const claudeResponse = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: MED_LABEL_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mimeType, data: base64Data },
              },
              {
                type: "text",
                text: "Extract medication information from this label. Return JSON only.",
              },
            ],
          },
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const errBody = await claudeResponse.text();
      console.error("Claude API error:", claudeResponse.status, errBody);
      await markFailed(supabase, artifactId);
      return json({ error: "AI extraction failed" }, 502);
    }

    const claudeResult = await claudeResponse.json();
    const textBlock = claudeResult.content?.find(
      (b: { type: string }) => b.type === "text",
    );

    if (!textBlock?.text) {
      await markFailed(supabase, artifactId);
      return json({ error: "Empty response from AI" }, 502);
    }

    let medication;
    try {
      const cleanJson = textBlock.text
        .replace(/^```json?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      medication = JSON.parse(cleanJson);
    } catch {
      await markFailed(supabase, artifactId);
      return json({ error: "AI returned invalid JSON" }, 502);
    }

    await supabase
      .from("artifacts")
      .update({
        processing_status: "completed",
        classification: "medication_bottle",
      })
      .eq("id", artifactId);

    return json({ medication });
  } catch (err) {
    console.error("Unhandled error in extract-med-label:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function markFailed(
  supabase: ReturnType<typeof createClient>,
  artifactId: string,
) {
  await supabase
    .from("artifacts")
    .update({ processing_status: "failed" })
    .eq("id", artifactId);
}
