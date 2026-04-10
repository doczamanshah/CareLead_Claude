/**
 * process-visit-prep — turns a patient's free-text input plus their profile
 * context into a structured Visit Prep object.
 *
 * The patient's voice comes first: questions/concerns they mention are
 * extracted verbatim and marked source: "patient". Anything the AI thinks
 * might also be worth raising (based on profile context) is added as a
 * source: "ai_suggested" item, clearly separated.
 *
 * Deploy with:
 *   supabase functions deploy process-visit-prep --no-verify-jwt \
 *     --project-ref ccpxoidlqsolzypmkiul
 */

import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are CareLead's Visit Prep assistant.

Your job is to take a patient's free-text description of what's on their mind for an upcoming medical visit, combine it with their health profile context, and produce a clean, structured Visit Prep JSON object.

THE PATIENT'S VOICE COMES FIRST.
- Extract every concern, symptom, question, and request the patient actually said. Preserve their meaning. Do NOT paraphrase aggressively or invent items they didn't say.
- Items that come from the patient's words MUST have source: "patient".
- Items the AI adds based on profile context (NOT mentioned by the patient) MUST have source: "ai_suggested" and ai_suggested: true.

EXTRACT THESE BUCKETS:
1. questions_and_concerns: Questions or concerns to raise with the doctor. Each is a short, plain-English line ("Discuss recurring headaches over the past 2 weeks", "Ask whether I should keep taking lisinopril").
2. logistics: Anything the patient said about getting there (driver, ride, timing, mobility help, translator, what to bring). Free-form short strings.
3. refills_needed: Medications the patient said they need refilled. Use plain medication names.
4. ai_suggestions: 1-2 additional questions or items the patient did NOT mention but that you think are worth raising based on their profile (active conditions, current medications, allergies, recent measurements). Each must have a brief reason citing the profile context. Do not duplicate anything the patient already said. Return an empty array if nothing useful.

STRICT RULES:
- Return ONLY valid JSON. No markdown fences. No commentary.
- Never invent symptoms, diagnoses, or medications the patient didn't mention.
- Never give clinical advice. You are organizing the patient's own words, not diagnosing.
- If the patient input is empty or unrelated to a medical visit, return empty arrays — never make things up.

RESPONSE SHAPE (return EXACTLY this structure):
{
  "questions_and_concerns": [
    { "text": "string", "source": "patient" }
  ],
  "logistics": {
    "notes": ["string"],
    "needs_driver": false,
    "special_needs": ["string"]
  },
  "refills_needed": [
    { "medication": "string", "reason": "string" }
  ],
  "ai_suggestions": [
    { "text": "string", "source": "ai_suggested", "reason": "string" }
  ]
}`;

interface ProfileFactSummary {
  category: string;
  value: Record<string, unknown>;
}

interface RequestBody {
  patientInput: string;
  profileContext: {
    display_name?: string | null;
    facts: ProfileFactSummary[];
  };
  appointmentDetails: {
    title: string;
    appointment_type: string;
    provider_name?: string | null;
    start_time: string;
    purpose?: string | null;
  };
}

function buildUserPrompt(body: RequestBody): string {
  const { patientInput, profileContext, appointmentDetails } = body;

  const factLines: string[] = [];
  for (const f of profileContext.facts ?? []) {
    factLines.push(`- ${f.category}: ${JSON.stringify(f.value)}`);
  }

  return [
    `APPOINTMENT:`,
    `Title: ${appointmentDetails.title}`,
    `Type: ${appointmentDetails.appointment_type}`,
    appointmentDetails.provider_name
      ? `Provider: ${appointmentDetails.provider_name}`
      : null,
    `When: ${appointmentDetails.start_time}`,
    appointmentDetails.purpose ? `Purpose: ${appointmentDetails.purpose}` : null,
    ``,
    `PATIENT (${profileContext.display_name ?? "patient"}):`,
    ``,
    `PATIENT'S OWN WORDS (verbatim — this is the source of truth):`,
    patientInput.trim() || "(empty)",
    ``,
    `PROFILE CONTEXT (use only as background to suggest 1-2 extras the patient didn't mention):`,
    factLines.length > 0 ? factLines.join("\n") : "(no profile facts on file)",
    ``,
    `Now produce the JSON.`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as RequestBody;

    if (!body?.patientInput || typeof body.patientInput !== "string") {
      return new Response(
        JSON.stringify({ error: "patientInput is required" }),
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
      const errBody = await claudeResponse.text();
      console.error("Claude API error:", claudeResponse.status, errBody);
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
      console.error("Could not parse AI JSON:", err, textBlock.text);
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
        questions_and_concerns: parsed.questions_and_concerns ?? [],
        logistics: parsed.logistics ?? {
          notes: [],
          needs_driver: false,
          special_needs: [],
        },
        refills_needed: parsed.refills_needed ?? [],
        ai_suggestions: parsed.ai_suggestions ?? [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Unhandled error in process-visit-prep:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
