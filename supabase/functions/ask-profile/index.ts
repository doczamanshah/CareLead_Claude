// Deploy with:
// supabase functions deploy ask-profile --no-verify-jwt --project-ref ccpxoidlqsolzypmkiul
//
// Requires ANTHROPIC_API_KEY set as a Supabase Edge Function secret.

import { corsHeaders } from "../_shared/cors.ts";
import { logError } from "../_shared/logging.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";
const MAX_FACTS = 60;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseResponseJson(raw: string): Record<string, unknown> | null {
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

const SYSTEM_PROMPT = `You are a patient health profile assistant for CareLead. The patient has asked a question about their own health profile. Below is their structured profile data. Answer their question based ONLY on the data provided.

Rules:
- ONLY answer with information present in the provided data. If the data doesn't contain the answer, say "I don't have that information in your profile."
- Do NOT provide medical advice, interpretation, or recommendations.
- Do NOT diagnose or suggest treatments.
- Be concise and direct.
- If a value has a flag (high/low/abnormal), mention it factually: "Your [lab] was [value], which was flagged as [flag]."
- Mention when the data was last updated if available.
- For clinical interpretation, suggest the user "ask your doctor".
- When you cite a fact, use its source_id in the card's source_id field so the UI can link to it.

Return ONLY valid JSON in this exact shape:
{
  "short_answer": "1-2 sentence direct answer",
  "cards": [
    {
      "title": "string",
      "primary_value": "string",
      "secondary_value": "string or null",
      "domain": "medications | labs | allergies | conditions | appointments | insurance | care_team | surgeries | immunizations | vitals | results | billing | preventive",
      "date_relevant": "ISO date string or null",
      "source_id": "the fact's source_id or null"
    }
  ],
  "suggested_follow_ups": ["string", "string"],
  "no_results": false
}

If the profile data cannot answer the question, return:
{
  "short_answer": "I don't have that information in your profile.",
  "cards": [],
  "suggested_follow_ups": ["...", "..."],
  "no_results": true
}

Return JSON only, no markdown.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { query, profile_name, facts } = body as {
      query?: string;
      profile_name?: string;
      facts?: unknown[];
    };

    if (!query || typeof query !== "string") {
      return jsonResponse({ error: "query is required" }, 400);
    }
    if (!Array.isArray(facts)) {
      return jsonResponse({ error: "facts[] is required" }, 400);
    }

    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }

    const trimmedFacts = facts.slice(0, MAX_FACTS);
    const userPrompt = `Patient: ${profile_name ?? "the patient"}
Question: ${query}

Profile data (JSON array of facts):
${JSON.stringify(trimmedFacts, null, 2)}

Return the JSON response now.`;

    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: userPrompt }],
          },
        ],
      }),
    });

    if (!resp.ok) {
      await resp.text().catch(() => undefined);
      logError("ask-profile.claude_error", undefined, { status: resp.status });
      return jsonResponse({ error: "AI query failed" }, 502);
    }

    const result = await resp.json();
    const textBlock = result.content?.find(
      (b: { type: string }) => b.type === "text",
    );
    if (!textBlock?.text) {
      return jsonResponse({ error: "Empty response from AI" }, 502);
    }

    const parsed = parseResponseJson(textBlock.text);
    if (!parsed) {
      return jsonResponse({ error: "AI returned invalid JSON" }, 502);
    }

    return jsonResponse(parsed);
  } catch (err) {
    logError("ask-profile.unhandled", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
