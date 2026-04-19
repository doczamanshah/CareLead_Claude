// Deploy with:
// supabase functions deploy extract-priorities --no-verify-jwt --project-ref ccpxoidlqsolzypmkiul
//
// Extracts structured patient priorities from free-text input.
// Requires ANTHROPIC_API_KEY set as a Supabase Edge Function secret.

import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

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

const SYSTEM_PROMPT = `You are a patient care priorities assistant. A patient has described what matters most to them in managing their health. Extract their priorities, friction points, and preferences.

Return ONLY valid JSON with this exact shape:
{
  "health_priorities": [
    { "topic": string, "importance": "high" | "medium", "detail": string or null }
  ],
  "friction_points": [
    { "area": string, "description": string, "category": "medications" | "appointments" | "billing" | "results" | "preventive" | "coordination" | "other" }
  ],
  "tracking_difficulties": [
    { "what": string, "category": string }
  ],
  "support_context": {
    "helpers": string[],
    "coordination_challenges": string or null
  },
  "reminder_preferences": {
    "preferred_time": string or null,
    "frequency_preference": "minimal" | "moderate" | "frequent" | null,
    "channels": string[]
  },
  "conditions_of_focus": string[],
  "confidence": number
}

Rules:
- Extract only what the patient EXPLICITLY stated. Do not infer.
- If a section has no information, use an empty array [] or null.
- "health_priorities.topic" is a short label (e.g. "diabetes management", "staying independent").
- "friction_points.category" must be one of the allowed enum values.
- "conditions_of_focus" is a list of condition names the patient mentioned caring about.
- "confidence" is 0..1 reflecting how clearly the patient expressed priorities.
- Return valid JSON only — no markdown, no commentary.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { text, profileName } = body as {
      text?: string;
      profileName?: string;
    };

    if (!text || typeof text !== "string" || text.trim().length < 3) {
      return jsonResponse(
        { error: "text is required and must be non-empty" },
        400,
      );
    }

    if (text.length > 8000) {
      return jsonResponse(
        { error: "Input too long. Please keep it under 8000 characters." },
        413,
      );
    }

    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }

    const safeProfileName = (profileName ?? "the patient")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 120);

    const userPrompt = `Patient: ${safeProfileName}

What the patient said:
"""
${text.trim()}
"""

Extract structured priorities as JSON. Return JSON only.`;

    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("Claude API error:", resp.status, errBody);
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

    // Sanitize and return with sensible defaults
    const healthPriorities = Array.isArray(extraction.health_priorities)
      ? extraction.health_priorities
      : [];
    const frictionPoints = Array.isArray(extraction.friction_points)
      ? extraction.friction_points
      : [];
    const trackingDifficulties = Array.isArray(extraction.tracking_difficulties)
      ? extraction.tracking_difficulties
      : [];
    const conditionsOfFocus = Array.isArray(extraction.conditions_of_focus)
      ? extraction.conditions_of_focus
      : [];
    const supportContext = extraction.support_context ?? null;
    const reminderPreferences = extraction.reminder_preferences ?? null;
    const confidence =
      typeof extraction.confidence === "number"
        ? Math.max(0, Math.min(1, extraction.confidence))
        : 0.5;

    return jsonResponse({
      health_priorities: healthPriorities,
      friction_points: frictionPoints,
      tracking_difficulties: trackingDifficulties,
      support_context: supportContext,
      reminder_preferences: reminderPreferences,
      conditions_of_focus: conditionsOfFocus,
      confidence,
    });
  } catch (err) {
    console.error("Unhandled error in extract-priorities:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
