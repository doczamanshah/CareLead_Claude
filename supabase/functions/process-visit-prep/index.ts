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
import { logError } from "../_shared/logging.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are CareLead's Visit Prep assistant.

Your job is to take a patient's free-text description of what's on their mind for an upcoming medical visit, combine it with their health profile context, and produce a clean, structured Visit Prep JSON object.

THE PATIENT'S VOICE COMES FIRST.
- Extract every concern, symptom, question, and request the patient actually said. Preserve their meaning. Do NOT paraphrase aggressively or invent items they didn't say.
- Items that come from the patient's words MUST have source: "patient".
- Items the AI adds based on profile context (NOT mentioned by the patient) MUST have source: "ai_suggested" and ai_suggested: true.

EXTRACT THESE BUCKETS:
1. questions_and_concerns: Questions or concerns to raise with the doctor. Each is a short, plain-English line ("Discuss recurring headaches over the past 2 weeks", "Ask whether I should keep taking lisinopril").
2. logistics: Transportation, timing, and items to bring. IMPORTANT — distinguish between:
   - DRIVER / TRANSPORTATION: If the patient mentions someone taking them, driving them, dropping them off, or providing a ride ("my daughter will drive me", "my son will take me", "Sarah is driving", "I need a ride", "my wife is coming with me to drive"), extract that person's name into the "driver" field. This is NOT an item to bring.
   - WHAT TO BRING: Physical items the patient should bring to the appointment ("bring medications", "bring insurance card", "bring lab results", "don't forget the referral"). These go into "what_to_bring".
   - SPECIAL NEEDS: Mobility assistance, translator, wheelchair, etc. These go into "special_needs".
   - NOTES: Other logistics info (parking, timing, directions) go into "notes".
3. refills_needed: Medications the patient said they need refilled. Use plain medication names.
4. ai_suggestions: 1-2 additional questions or items the patient did NOT mention but that you think are worth raising based on their profile (active conditions, current medications, allergies, recent measurements). Each must have a brief reason citing the profile context. Do not duplicate anything the patient already said. Return an empty array if nothing useful.

STRICT RULES:
- Return ONLY valid JSON. No markdown fences. No commentary.
- Never invent symptoms, diagnoses, or medications the patient didn't mention.
- Never give clinical advice. You are organizing the patient's own words, not diagnosing.
- If the patient input is empty or unrelated to a medical visit, return empty arrays — never make things up.
- CRITICAL: When someone says "my [person] will drive me" or "my [person] will take me" — that is a DRIVER, not an item to bring. Put it in logistics.driver, NOT logistics.what_to_bring.

RESPONSE SHAPE (return EXACTLY this structure):
{
  "questions_and_concerns": [
    { "text": "string", "source": "patient" }
  ],
  "logistics": {
    "driver": { "name": "string or null — the person driving/taking the patient" },
    "what_to_bring": ["string — physical items to bring"],
    "notes": ["string — other logistics notes"],
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
      await claudeResponse.text().catch(() => undefined);
      logError("process-visit-prep.claude_error", undefined, { status: claudeResponse.status });
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
      // textBlock.text contains the AI's extracted PHI — never log it.
      logError("process-visit-prep.parse_failed", err);
      return new Response(
        JSON.stringify({ error: "AI returned invalid JSON" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Normalize the logistics object — map driver info properly
    const rawLogistics = parsed.logistics ?? {};
    const driverInfo = rawLogistics.driver;
    const logistics = {
      driver: driverInfo?.name
        ? { name: driverInfo.name, user_id: null, notified: false }
        : null,
      what_to_bring: rawLogistics.what_to_bring ?? [],
      notes: rawLogistics.notes ?? [],
      needs_driver: rawLogistics.needs_driver ?? (driverInfo?.name ? false : false),
      special_needs: rawLogistics.special_needs ?? [],
    };

    return new Response(
      JSON.stringify({
        questions_and_concerns: parsed.questions_and_concerns ?? [],
        logistics,
        refills_needed: parsed.refills_needed ?? [],
        ai_suggestions: parsed.ai_suggestions ?? [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    logError("process-visit-prep.unhandled", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
