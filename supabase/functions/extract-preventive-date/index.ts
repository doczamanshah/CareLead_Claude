// Deploy with:
// supabase functions deploy extract-preventive-date --no-verify-jwt --project-ref ccpxoidlqsolzypmkiul
//
// Requires ANTHROPIC_API_KEY set as a Supabase Edge Function secret
// (shared with other extract-* functions).

import { corsHeaders } from "../_shared/cors.ts";
import { logError } from "../_shared/logging.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MAX_BASE64_LENGTH = Math.ceil((20 * 1024 * 1024 * 4) / 3); // ~20MB decoded

const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

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

function buildSystemPrompt(screeningTitle: string): string {
  const safeTitle = screeningTitle.replace(/[\r\n]+/g, " ").trim();
  return `You are a medical document date extraction assistant. The user has uploaded a document as proof that they completed a preventive screening: "${safeTitle}".

Your ONLY job is to find the date this screening or procedure was performed/completed.

Return ONLY valid JSON:
{
  "date_found": true | false,
  "completion_date": "YYYY-MM-DD" or null,
  "confidence": number between 0 and 1,
  "evidence_text": string or null (the text in the document that indicates the date)
}

Look for: procedure dates, service dates, visit dates, vaccination dates, collection dates, report dates. Use the most specific date that indicates when the screening was actually performed. Return valid JSON only, no markdown.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      documentBase64,
      mimeType,
      screeningType,
      screeningTitle,
    } = body as {
      documentBase64?: string;
      mimeType?: string;
      screeningType?: string;
      screeningTitle?: string;
    };

    if (!documentBase64 || !mimeType || !screeningTitle) {
      return jsonResponse(
        { error: "documentBase64, mimeType, and screeningTitle are required" },
        400,
      );
    }

    if (documentBase64.length > MAX_BASE64_LENGTH) {
      return jsonResponse(
        { error: "File too large. Maximum size is 20 MB." },
        413,
      );
    }

    const isImage = SUPPORTED_IMAGE_TYPES.includes(mimeType);
    const isPdf = mimeType === "application/pdf";
    if (!isImage && !isPdf) {
      return jsonResponse(
        { error: `Unsupported file type: ${mimeType}` },
        400,
      );
    }

    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }

    const contentBlock: Record<string, unknown> = isPdf
      ? {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: documentBase64,
          },
        }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: mimeType,
            data: documentBase64,
          },
        };

    const userPrompt = isPdf
      ? `Find the date this screening was performed. Screening context: "${screeningType ?? "unknown"}". Return JSON only.`
      : `Find the date this screening was performed. Screening context: "${screeningType ?? "unknown"}". Return JSON only.`;

    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
        system: buildSystemPrompt(screeningTitle),
        messages: [
          {
            role: "user",
            content: [contentBlock, { type: "text", text: userPrompt }],
          },
        ],
      }),
    });

    if (!resp.ok) {
      await resp.text().catch(() => undefined);
      logError("extract-preventive-date.claude_error", undefined, { status: resp.status });
      return jsonResponse({ error: "AI extraction failed" }, 502);
    }

    const result = await resp.json();
    const textBlock = result.content?.find(
      (b: { type: string }) => b.type === "text",
    );
    if (!textBlock?.text) {
      return jsonResponse({ error: "Empty response from AI" }, 502);
    }

    const extraction = parseExtractionJson(textBlock.text);
    if (!extraction) {
      return jsonResponse({ error: "AI returned invalid JSON" }, 502);
    }

    const dateFound = extraction.date_found === true;
    const completionDate =
      typeof extraction.completion_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(extraction.completion_date)
        ? extraction.completion_date
        : null;
    const confidence =
      typeof extraction.confidence === "number"
        ? Math.max(0, Math.min(1, extraction.confidence))
        : 0;
    const evidenceText =
      typeof extraction.evidence_text === "string"
        ? extraction.evidence_text
        : null;

    return jsonResponse({
      date_found: dateFound && !!completionDate,
      completion_date: completionDate,
      confidence,
      evidence_text: evidenceText,
    });
  } catch (err) {
    logError("extract-preventive-date.unhandled", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
