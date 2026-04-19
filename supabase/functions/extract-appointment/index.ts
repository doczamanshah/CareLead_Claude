/**
 * extract-appointment — turns a patient's free-text description of an
 * upcoming appointment into a structured set of appointment fields.
 *
 * The patient dictates or types what they know ("I have a follow-up with
 * Dr. Iqbal at SPC tomorrow at 10am for my blood pressure"), and the AI
 * pulls out the title, provider, facility, date/time, reason, concerns,
 * companion, transportation, and any special prep notes.
 *
 * Relative dates ("tomorrow", "next Tuesday", "in 2 weeks") are resolved
 * against today's date on the server.
 *
 * Deploy with:
 *   supabase functions deploy extract-appointment --no-verify-jwt \
 *     --project-ref ccpxoidlqsolzypmkiul
 */

import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const APPOINTMENT_TYPES = [
  "doctor_visit",
  "labs",
  "imaging",
  "procedure",
  "therapy",
  "other",
] as const;

interface RequestBody {
  text: string;
  profileName?: string | null;
}

function buildSystemPrompt(todayISO: string): string {
  return `You are CareLead's appointment extraction assistant.

A patient has described an upcoming appointment in their own words. Extract every structured detail you can identify.

RETURN ONLY valid JSON matching this exact shape (no markdown, no commentary):
{
  "title": string or null,
  "appointment_type": "doctor_visit" | "labs" | "imaging" | "procedure" | "therapy" | "other" | null,
  "provider_name": string or null,
  "facility_name": string or null,
  "location_address": string or null,
  "date": "YYYY-MM-DD" or null,
  "time": "HH:MM" (24-hour) or null,
  "date_description": string or null,
  "reason_for_visit": string or null,
  "concerns_to_discuss": string[],
  "companion": string or null,
  "transportation": string or null,
  "special_needs": string[],
  "prep_notes": string or null,
  "additional_context": string or null,
  "confidence": number between 0 and 1
}

FIELD RULES:
- title: a short, descriptive label ("PCP Follow-up", "Cardiology Visit", "Blood Work", "Knee MRI"). Keep it concise. If the patient never said why, use the provider/facility or appointment type.
- appointment_type: pick the single best match from the enum. "doctor_visit" is the default for a visit with a provider. Use "labs" for blood draws / lab work, "imaging" for MRI/X-ray/CT/ultrasound, "procedure" for surgeries/scopes/biopsies, "therapy" for PT/OT/counseling, and "other" only when nothing else fits.
- provider_name: the clinician's name if mentioned ("Dr. Iqbal", "Dr. Sarah Chen", "Nurse Practitioner Lopez"). Preserve titles.
- facility_name: clinic/hospital name if distinct from the provider ("SPC clinic", "Memorial Hospital", "Northside Imaging").
- location_address: a street address if the patient explicitly stated one. Do NOT invent addresses.
- date: an absolute date in YYYY-MM-DD. Resolve relative dates against today (${todayISO}). Examples: "tomorrow" → next day, "next Tuesday" → the coming Tuesday, "in 2 weeks" → today + 14 days, "the 15th" → the 15th of this month (or next month if already past).
- time: 24-hour HH:MM. "10am" → "10:00", "2:30 PM" → "14:30". Only fill this if the patient gave a time.
- date_description: the original phrase the patient used for the date ("tomorrow", "next week", "around Thursday"). Helps if the exact date can't be parsed.
- reason_for_visit: the clinical reason, not the visit title ("blood pressure check", "follow-up on knee surgery", "annual physical", "persistent cough").
- concerns_to_discuss: specific questions or topics the patient wants to raise. Each is a short, plain-English line. Do NOT duplicate the reason_for_visit here.
- companion: the person going with them ("my daughter Sarah", "my wife", "Mom"). Null if no one is mentioned.
- transportation: how they're getting there ("daughter is driving", "taking an Uber", "driving myself"). Null if not mentioned.
- special_needs: mobility/accessibility/fasting/interpreter/documents to bring ("fasting required", "need interpreter", "wheelchair", "bring referral letter").
- prep_notes: any preparation instructions the patient mentioned that don't fit in special_needs ("no eating after midnight", "hold blood pressure meds that morning").
- additional_context: anything relevant the patient said that doesn't fit the other fields (a brief summary, not a repeat).
- confidence: your confidence that the extraction is accurate and complete, 0 to 1.

STRICT RULES:
- Extract ONLY what the patient explicitly stated. Never invent symptoms, provider names, or facilities.
- Null out fields that were not mentioned — do not guess.
- Never include PHI in fabricated form (no made-up dates, provider names, or diagnoses).
- Return strict JSON only. No markdown fences. No explanations.`;
}

function buildUserPrompt(body: RequestBody): string {
  const lines = [
    body.profileName
      ? `Patient: ${body.profileName}`
      : null,
    ``,
    `Patient said:`,
    body.text.trim(),
    ``,
    `Extract the appointment details as JSON.`,
  ].filter((line) => line !== null);
  return lines.join("\n");
}

function todayIsoDate(): string {
  return new Date().toISOString().split("T")[0];
}

function sanitizeAppointmentType(
  value: unknown,
): (typeof APPOINTMENT_TYPES)[number] | null {
  if (typeof value !== "string") return null;
  return (APPOINTMENT_TYPES as readonly string[]).includes(value)
    ? (value as (typeof APPOINTMENT_TYPES)[number])
    : null;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
}

function sanitizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}$/);
  if (!match) return null;
  const d = new Date(value + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : value;
}

function sanitizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hh = parseInt(match[1], 10);
  const mm = parseInt(match[2], 10);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function sanitizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeConfidence(value: unknown): number {
  if (typeof value !== "number") return 0.5;
  if (Number.isNaN(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as RequestBody;

    if (!body?.text || typeof body.text !== "string" || !body.text.trim()) {
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

    const todayISO = todayIsoDate();
    const systemPrompt = buildSystemPrompt(todayISO);
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
        max_tokens: 1024,
        system: systemPrompt,
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

    let parsed: Record<string, unknown>;
    try {
      const cleanJson = textBlock.text
        .replace(/^```json?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      parsed = JSON.parse(cleanJson) as Record<string, unknown>;
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

    const result = {
      title: sanitizeString(parsed.title),
      appointment_type: sanitizeAppointmentType(parsed.appointment_type),
      provider_name: sanitizeString(parsed.provider_name),
      facility_name: sanitizeString(parsed.facility_name),
      location_address: sanitizeString(parsed.location_address),
      date: sanitizeDate(parsed.date),
      time: sanitizeTime(parsed.time),
      date_description: sanitizeString(parsed.date_description),
      reason_for_visit: sanitizeString(parsed.reason_for_visit),
      concerns_to_discuss: sanitizeStringArray(parsed.concerns_to_discuss),
      companion: sanitizeString(parsed.companion),
      transportation: sanitizeString(parsed.transportation),
      special_needs: sanitizeStringArray(parsed.special_needs),
      prep_notes: sanitizeString(parsed.prep_notes),
      additional_context: sanitizeString(parsed.additional_context),
      confidence: sanitizeConfidence(parsed.confidence),
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unhandled error in extract-appointment:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
