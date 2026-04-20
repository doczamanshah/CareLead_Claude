/**
 * extract-wellness-input — turns a patient's free-text wellness-visit prep
 * narrative into structured buckets (symptoms, medication concerns, condition
 * updates, questions for the doctor, lifestyle changes, screening requests,
 * profile update suggestions).
 *
 * The patient's voice is the source of truth. Extract ONLY what was said. The
 * downstream UI lets the user edit/reject each item before anything is saved
 * to the profile.
 *
 * Deploy with:
 *   supabase functions deploy extract-wellness-input --no-verify-jwt \
 *     --project-ref ccpxoidlqsolzypmkiul
 */

import { corsHeaders } from "../_shared/cors.ts";
import { logError } from "../_shared/logging.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are a patient wellness visit preparation assistant. A patient is preparing for their annual wellness visit and has shared their thoughts, concerns, and health updates. Extract structured information to help them prepare.

Return ONLY valid JSON — no markdown fences, no commentary. Use this exact shape:
{
  "new_symptoms": [
    { "description": string, "duration": string or null, "severity": string or null }
  ],
  "medication_concerns": [
    { "medication": string or null, "concern": string }
  ],
  "condition_updates": [
    { "condition": string, "update_type": "new" | "worsening" | "improving" | "resolved", "detail": string or null }
  ],
  "questions_for_doctor": [
    { "question": string, "priority": "high" | "medium" | "low", "category": string }
  ],
  "lifestyle_changes": [
    { "area": string, "detail": string }
  ],
  "screening_requests": [
    { "screening": string, "reason": string or null }
  ],
  "other_concerns": [string],
  "profile_updates_suggested": [
    { "category": string, "action": "add" | "update" | "remove", "detail": string }
  ],
  "confidence": number
}

STRICT RULES:
- Extract ONLY what the patient explicitly stated. Never invent symptoms, diagnoses, medications, or screenings.
- Phrase questions_for_doctor in first person ("Should I get the shingles vaccine?", "Why is my blood pressure running high?").
- Priority for questions: "high" for new/worsening symptoms, medication safety, or patient-stated concerns; "medium" for screenings and check-ins; "low" for general curiosity.
- category for questions: one of "symptoms", "medications", "screenings", "lifestyle", "general".
- area for lifestyle_changes: one of "diet", "exercise", "sleep", "stress", "alcohol", "tobacco", "weight", "other".
- For screening_requests, use the patient's own words for the screening type (e.g. "eye exam for diabetes", "shingles vaccine", "mammogram").
- For profile_updates_suggested, only include items the patient clearly said changed (e.g. "I switched insurance", "I stopped taking metformin"). Categories: "medication", "condition", "allergy", "insurance", "care_team", "pharmacy", "emergency_contact".
- confidence is a number 0–1 reflecting how cleanly the input mapped to the schema.
- If the input is empty or unrelated, return all empty arrays. Never fabricate.
- Do not give clinical advice. You are organizing the patient's words, not diagnosing.`;

interface RequestBody {
  text: string;
  profileName?: string | null;
  existingConditions?: string[];
  existingMedications?: string[];
}

function buildUserPrompt(body: RequestBody): string {
  const conditions = (body.existingConditions ?? []).slice(0, 20);
  const medications = (body.existingMedications ?? []).slice(0, 30);

  const lines: (string | null)[] = [
    `PATIENT: ${body.profileName ?? "patient"}`,
    conditions.length > 0
      ? `EXISTING CONDITIONS (for context only — do NOT restate unless patient mentions them): ${conditions.join(", ")}`
      : null,
    medications.length > 0
      ? `EXISTING MEDICATIONS (for context only — do NOT restate unless patient mentions them): ${medications.join(", ")}`
      : null,
    "",
    "PATIENT'S OWN WORDS (verbatim — source of truth):",
    body.text.trim() || "(empty)",
    "",
    "Now produce the JSON.",
  ];

  return lines.filter((line) => line !== null).join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as RequestBody;

    if (!body?.text || typeof body.text !== "string") {
      return new Response(
        JSON.stringify({ error: "text is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const userPrompt = buildUserPrompt(body);

    const claudeResponse = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeResponse.ok) {
      await claudeResponse.text().catch(() => undefined);
      logError("extract-wellness-input.claude_error", undefined, { status: claudeResponse.status });
      return new Response(
        JSON.stringify({ error: "AI processing failed" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const claudeResult = await claudeResponse.json();
    const textBlock = claudeResult.content?.find(
      (b: { type: string }) => b.type === "text",
    );

    if (!textBlock?.text) {
      return new Response(
        JSON.stringify({ error: "AI returned empty response" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let parsed;
    try {
      const cleanJson = textBlock.text
        .replace(/^```json?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      parsed = JSON.parse(cleanJson);
    } catch (err) {
      logError("extract-wellness-input.parse_failed", err);
      return new Response(
        JSON.stringify({ error: "AI returned invalid JSON" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        new_symptoms: Array.isArray(parsed.new_symptoms) ? parsed.new_symptoms : [],
        medication_concerns: Array.isArray(parsed.medication_concerns)
          ? parsed.medication_concerns
          : [],
        condition_updates: Array.isArray(parsed.condition_updates)
          ? parsed.condition_updates
          : [],
        questions_for_doctor: Array.isArray(parsed.questions_for_doctor)
          ? parsed.questions_for_doctor
          : [],
        lifestyle_changes: Array.isArray(parsed.lifestyle_changes)
          ? parsed.lifestyle_changes
          : [],
        screening_requests: Array.isArray(parsed.screening_requests)
          ? parsed.screening_requests
          : [],
        other_concerns: Array.isArray(parsed.other_concerns)
          ? parsed.other_concerns
          : [],
        profile_updates_suggested: Array.isArray(parsed.profile_updates_suggested)
          ? parsed.profile_updates_suggested
          : [],
        confidence:
          typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    logError("extract-wellness-input.unhandled", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
