import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logError } from "../_shared/logging.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are a health summary extraction assistant. This document is a patient health summary (CCD, CCDA, or similar comprehensive health record). Extract ALL available health information organized by category.

Return ONLY valid JSON, no markdown fences, no commentary:
{
  "patient_name": string or null,
  "date_of_birth": "YYYY-MM-DD" or null,
  "gender": string or null,
  "medications": [
    { "name": string, "dose": string or null, "frequency": string or null, "prescriber": string or null, "start_date": string or null, "status": "active" | "inactive" | null }
  ],
  "allergies": [
    { "allergen": string, "reaction": string or null, "severity": string or null }
  ],
  "conditions": [
    { "name": string, "onset_date": string or null, "status": "active" | "resolved" | null }
  ],
  "procedures": [
    { "name": string, "date": string or null, "provider": string or null }
  ],
  "immunizations": [
    { "name": string, "date": string or null, "site": string or null }
  ],
  "lab_results": [
    { "test_name": string, "date": string or null, "results": [
      { "analyte": string, "value": string, "unit": string or null, "ref_range": string or null, "flag": string or null }
    ]}
  ],
  "providers": [
    { "name": string, "specialty": string or null, "organization": string or null, "phone": string or null }
  ],
  "insurance": [
    { "payer": string, "member_id": string or null, "group_number": string or null, "plan_name": string or null }
  ],
  "emergency_contacts": [
    { "name": string, "relationship": string or null, "phone": string or null }
  ],
  "overall_confidence": number between 0 and 1,
  "sections_found": string[]
}

Extract ONLY explicitly stated information. Do not invent or infer values. Return valid JSON only.`;

type ExtractionResult = {
  patient_name: string | null;
  date_of_birth: string | null;
  gender: string | null;
  medications: Array<Record<string, string | null>>;
  allergies: Array<Record<string, string | null>>;
  conditions: Array<Record<string, string | null>>;
  procedures: Array<Record<string, string | null>>;
  immunizations: Array<Record<string, string | null>>;
  lab_results: Array<Record<string, unknown>>;
  providers: Array<Record<string, string | null>>;
  insurance: Array<Record<string, string | null>>;
  emergency_contacts: Array<Record<string, string | null>>;
  overall_confidence: number;
  sections_found: string[];
};

function emptyExtraction(): ExtractionResult {
  return {
    patient_name: null,
    date_of_birth: null,
    gender: null,
    medications: [],
    allergies: [],
    conditions: [],
    procedures: [],
    immunizations: [],
    lab_results: [],
    providers: [],
    insurance: [],
    emergency_contacts: [],
    overall_confidence: 0,
    sections_found: [],
  };
}

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

    const mimeType: string = artifact.mime_type || "application/octet-stream";
    const lowerName = (artifact.file_name || "").toLowerCase();
    const isXml =
      mimeType === "application/xml" ||
      mimeType === "text/xml" ||
      lowerName.endsWith(".xml") ||
      lowerName.endsWith(".ccd") ||
      lowerName.endsWith(".ccda");
    const isHtml = mimeType === "text/html" || lowerName.endsWith(".html") || lowerName.endsWith(".htm");
    const isPdf = mimeType === "application/pdf" || lowerName.endsWith(".pdf");
    const isImage = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mimeType);

    let extraction: ExtractionResult | null = null;

    if (isXml || isHtml) {
      const text = await downloadText(supabase, artifact.file_path);
      if (!text) {
        await markFailed(supabase, artifactId);
        return json({ error: "Could not download file contents" }, 500);
      }
      if (isXml) {
        const parsed = parseCcdaXml(text);
        if (parsed && hasAnyData(parsed)) {
          extraction = parsed;
        } else {
          // Fall back to Claude text extraction for malformed CCD/CCDA
          extraction = await extractFromText(text);
        }
      } else {
        extraction = await extractFromText(text);
      }
    } else if (isPdf) {
      const base64 = await downloadBase64(supabase, artifact.file_path);
      if (!base64) {
        await markFailed(supabase, artifactId);
        return json({ error: "Could not download file" }, 500);
      }
      extraction = await extractFromMedia("document", "application/pdf", base64);
    } else if (isImage) {
      const base64 = await downloadBase64(supabase, artifact.file_path);
      if (!base64) {
        await markFailed(supabase, artifactId);
        return json({ error: "Could not download file" }, 500);
      }
      extraction = await extractFromMedia("image", mimeType, base64);
    } else {
      await markFailed(supabase, artifactId);
      return json(
        {
          error: `Unsupported file type for health summary: ${mimeType}. Use XML, PDF, HTML, or image.`,
        },
        400,
      );
    }

    if (!extraction) {
      await markFailed(supabase, artifactId);
      return json({ error: "Extraction returned no data" }, 502);
    }

    await supabase
      .from("artifacts")
      .update({
        processing_status: "completed",
        classification: "health_summary",
      })
      .eq("id", artifactId);

    return json({ summary: extraction });
  } catch (err) {
    logError("extract-health-summary.unhandled", err);
    return json({ error: "Internal server error" }, 500);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

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

async function downloadBase64(
  supabase: ReturnType<typeof createClient>,
  filePath: string,
): Promise<string | null> {
  const { data: urlData, error } = await supabase.storage
    .from("artifacts")
    .createSignedUrl(filePath, 600);
  if (error || !urlData?.signedUrl) return null;

  const res = await fetch(urlData.signedUrl);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  return btoa(
    new Uint8Array(buf).reduce((data, byte) => data + String.fromCharCode(byte), ""),
  );
}

async function downloadText(
  supabase: ReturnType<typeof createClient>,
  filePath: string,
): Promise<string | null> {
  const { data: urlData, error } = await supabase.storage
    .from("artifacts")
    .createSignedUrl(filePath, 600);
  if (error || !urlData?.signedUrl) return null;

  const res = await fetch(urlData.signedUrl);
  if (!res.ok) return null;
  return await res.text();
}

async function extractFromMedia(
  kind: "image" | "document",
  mediaType: string,
  base64: string,
): Promise<ExtractionResult | null> {
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY")!;
  const contentBlock =
    kind === "document"
      ? {
          type: "document",
          source: { type: "base64", media_type: mediaType, data: base64 },
        }
      : {
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64 },
        };

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            contentBlock,
            {
              type: "text",
              text:
                "Extract every section of this health summary into the required JSON schema. Return JSON only.",
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    await res.text().catch(() => undefined);
    logError("extract-health-summary.claude_error_file", undefined, { status: res.status });
    return null;
  }
  const result = await res.json();
  return parseClaudeJson(result);
}

async function extractFromText(text: string): Promise<ExtractionResult | null> {
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY")!;

  // Safety: trim to avoid massive prompts. Health summaries typically fit well
  // under this even with verbose CCDA markup.
  const MAX_CHARS = 200_000;
  const content = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Extract every section of the following health summary document into the required JSON schema. Return JSON only.\n\n---\n${content}\n---`,
        },
      ],
    }),
  });

  if (!res.ok) {
    await res.text().catch(() => undefined);
    logError("extract-health-summary.claude_error_text", undefined, { status: res.status });
    return null;
  }
  const result = await res.json();
  return parseClaudeJson(result);
}

function parseClaudeJson(claudeResult: {
  content?: Array<{ type: string; text?: string }>;
}): ExtractionResult | null {
  const textBlock = claudeResult.content?.find((b) => b.type === "text");
  if (!textBlock?.text) return null;

  try {
    const clean = textBlock.text
      .replace(/^```json?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(clean);
    return normalizeExtraction(parsed);
  } catch (err) {
    logError("extract-health-summary.parse_failed", err);
    return null;
  }
}

function normalizeExtraction(raw: unknown): ExtractionResult {
  const base = emptyExtraction();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;

  return {
    patient_name: stringOrNull(r.patient_name),
    date_of_birth: stringOrNull(r.date_of_birth),
    gender: stringOrNull(r.gender),
    medications: Array.isArray(r.medications) ? (r.medications as Array<Record<string, string | null>>) : [],
    allergies: Array.isArray(r.allergies) ? (r.allergies as Array<Record<string, string | null>>) : [],
    conditions: Array.isArray(r.conditions) ? (r.conditions as Array<Record<string, string | null>>) : [],
    procedures: Array.isArray(r.procedures) ? (r.procedures as Array<Record<string, string | null>>) : [],
    immunizations: Array.isArray(r.immunizations) ? (r.immunizations as Array<Record<string, string | null>>) : [],
    lab_results: Array.isArray(r.lab_results) ? (r.lab_results as Array<Record<string, unknown>>) : [],
    providers: Array.isArray(r.providers) ? (r.providers as Array<Record<string, string | null>>) : [],
    insurance: Array.isArray(r.insurance) ? (r.insurance as Array<Record<string, string | null>>) : [],
    emergency_contacts: Array.isArray(r.emergency_contacts) ? (r.emergency_contacts as Array<Record<string, string | null>>) : [],
    overall_confidence: typeof r.overall_confidence === "number" ? r.overall_confidence : 0.5,
    sections_found: Array.isArray(r.sections_found) ? (r.sections_found as string[]) : [],
  };
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function hasAnyData(e: ExtractionResult): boolean {
  return (
    e.medications.length > 0 ||
    e.allergies.length > 0 ||
    e.conditions.length > 0 ||
    e.procedures.length > 0 ||
    e.immunizations.length > 0 ||
    e.lab_results.length > 0 ||
    e.providers.length > 0 ||
    e.insurance.length > 0 ||
    e.emergency_contacts.length > 0
  );
}

// ── CCD/CCDA XML parsing ────────────────────────────────────────────────────
// A lightweight best-effort parser. CCDA is a large HL7 spec; we extract the
// common section templates (by LOINC code) and rely on free-text fallbacks
// inside the section when structured entries are sparse. If this returns
// mostly empty, the caller will fall back to Claude for extraction.

const SECTION_CODES = {
  MEDICATIONS: "10160-0",
  ALLERGIES: "48765-2",
  PROBLEMS: "11450-4",
  PROCEDURES: "47519-4",
  IMMUNIZATIONS: "11369-6",
  RESULTS: "30954-2",
  PROVIDERS_CARE_TEAM: "85847-2",
  ENCOUNTERS: "46240-8",
  PAYERS: "48768-6",
};

function parseCcdaXml(xml: string): ExtractionResult | null {
  const extraction = emptyExtraction();

  try {
    extraction.patient_name = pickTagText(xml, "recordTarget.*?<name[^>]*>(.*?)</name>");
    extraction.date_of_birth = pickAttribute(xml, /<birthTime\s+value="([^"]+)"/);
    if (extraction.date_of_birth) {
      extraction.date_of_birth = formatHl7Date(extraction.date_of_birth);
    }
    extraction.gender = pickAttribute(xml, /<administrativeGenderCode[^>]*code="([^"]+)"/);

    const sections = splitSections(xml);

    for (const section of sections) {
      const code = pickAttribute(section, /<code\s+[^>]*code="([^"]+)"/);
      if (!code) continue;

      switch (code) {
        case SECTION_CODES.MEDICATIONS: {
          const entries = collectEntries(section);
          for (const e of entries) {
            const name = pickTagText(e, "<manufacturedMaterial>(?:.|\\n)*?<name>(.*?)</name>");
            if (!name) continue;
            const doseValue = pickAttribute(e, /<doseQuantity\s+value="([^"]+)"/);
            const doseUnit = pickAttribute(e, /<doseQuantity[^>]*unit="([^"]+)"/);
            const frequency = pickTagText(e, "<effectiveTime[^>]*xsi:type=\"PIVL_TS\"[^>]*>(?:.|\\n)*?<period\\s+value=\"([^\"]+)\"\\s+unit=\"([^\"]+)\"");
            extraction.medications.push({
              name,
              dose: doseValue ? [doseValue, doseUnit].filter(Boolean).join(" ") : null,
              frequency: frequency ?? null,
              prescriber: null,
              start_date: formatHl7Date(pickAttribute(e, /<low\s+value="([^"]+)"/)),
              status: /statusCode[^>]*code="active"/i.test(e) ? "active" : null,
            });
          }
          if (entries.length > 0) extraction.sections_found.push("medications");
          break;
        }
        case SECTION_CODES.ALLERGIES: {
          const entries = collectEntries(section);
          for (const e of entries) {
            const allergen = pickTagText(e, "<playingEntity>(?:.|\\n)*?<name>(.*?)</name>");
            if (!allergen) continue;
            const reaction = pickTagText(e, "<observation>(?:.|\\n)*?<value[^>]*displayName=\"([^\"]+)\"");
            const severity = pickTagText(e, "<observation>(?:.|\\n)*?severity(?:.|\\n)*?displayName=\"([^\"]+)\"");
            extraction.allergies.push({
              allergen,
              reaction: reaction ?? null,
              severity: severity ?? null,
            });
          }
          if (entries.length > 0) extraction.sections_found.push("allergies");
          break;
        }
        case SECTION_CODES.PROBLEMS: {
          const entries = collectEntries(section);
          for (const e of entries) {
            const name = pickTagText(e, "<value[^>]*displayName=\"([^\"]+)\"");
            if (!name) continue;
            const onset = formatHl7Date(pickAttribute(e, /<low\s+value="([^"]+)"/));
            const resolved = /statusCode[^>]*code="(resolved|inactive|completed)"/i.test(e);
            extraction.conditions.push({
              name,
              onset_date: onset,
              status: resolved ? "resolved" : "active",
            });
          }
          if (entries.length > 0) extraction.sections_found.push("conditions");
          break;
        }
        case SECTION_CODES.PROCEDURES: {
          const entries = collectEntries(section);
          for (const e of entries) {
            const name = pickTagText(e, "<code[^>]*displayName=\"([^\"]+)\"");
            if (!name) continue;
            const date = formatHl7Date(pickAttribute(e, /<effectiveTime\s+value="([^"]+)"/));
            extraction.procedures.push({
              name,
              date,
              provider: null,
            });
          }
          if (entries.length > 0) extraction.sections_found.push("procedures");
          break;
        }
        case SECTION_CODES.IMMUNIZATIONS: {
          const entries = collectEntries(section);
          for (const e of entries) {
            const name = pickTagText(e, "<manufacturedMaterial>(?:.|\\n)*?<(?:name|translation[^>]*displayName=\")(.*?)(?:</name>|\")");
            if (!name) continue;
            const date = formatHl7Date(pickAttribute(e, /<effectiveTime\s+value="([^"]+)"/));
            extraction.immunizations.push({ name, date, site: null });
          }
          if (entries.length > 0) extraction.sections_found.push("immunizations");
          break;
        }
        case SECTION_CODES.RESULTS: {
          const organizers = collectTags(section, "organizer");
          for (const org of organizers) {
            const testName = pickTagText(org, "<code[^>]*displayName=\"([^\"]+)\"");
            const date = formatHl7Date(pickAttribute(org, /<effectiveTime\s+value="([^"]+)"/));
            const observations = collectTags(org, "observation");
            const results: Array<Record<string, unknown>> = [];
            for (const obs of observations) {
              const analyte = pickTagText(obs, "<code[^>]*displayName=\"([^\"]+)\"");
              const value = pickAttribute(obs, /<value[^>]*value="([^"]+)"/);
              const unit = pickAttribute(obs, /<value[^>]*unit="([^"]+)"/);
              const flag = pickTagText(obs, "<interpretationCode[^>]*displayName=\"([^\"]+)\"");
              if (!analyte) continue;
              results.push({ analyte, value, unit, ref_range: null, flag });
            }
            if (testName && results.length > 0) {
              extraction.lab_results.push({ test_name: testName, date, results });
            }
          }
          if (extraction.lab_results.length > 0) extraction.sections_found.push("lab_results");
          break;
        }
        case SECTION_CODES.PROVIDERS_CARE_TEAM: {
          const names = collectAllMatches(section, /<name[^>]*>(.*?)<\/name>/g);
          for (const name of names) {
            extraction.providers.push({
              name,
              specialty: null,
              organization: null,
              phone: null,
            });
          }
          if (names.length > 0) extraction.sections_found.push("providers");
          break;
        }
        case SECTION_CODES.PAYERS: {
          const entries = collectEntries(section);
          for (const e of entries) {
            const payer = pickTagText(e, "<name>(.*?)</name>");
            if (!payer) continue;
            extraction.insurance.push({
              payer,
              member_id: pickTagText(e, "<id[^>]*extension=\"([^\"]+)\""),
              group_number: null,
              plan_name: null,
            });
          }
          if (entries.length > 0) extraction.sections_found.push("insurance");
          break;
        }
        default:
          break;
      }
    }

    extraction.overall_confidence = hasAnyData(extraction) ? 0.85 : 0.2;
    return extraction;
  } catch (err) {
    logError("extract-health-summary.ccda_parse_error", err);
    return null;
  }
}

function splitSections(xml: string): string[] {
  const sections: string[] = [];
  const regex = /<section[\s>](?:[\s\S]*?)<\/section>/g;
  const matches = xml.match(regex);
  if (!matches) return [];
  sections.push(...matches);
  return sections;
}

function collectEntries(sectionXml: string): string[] {
  const out: string[] = [];
  const regex = /<entry[\s>][\s\S]*?<\/entry>/g;
  const matches = sectionXml.match(regex);
  if (!matches) return [];
  out.push(...matches);
  return out;
}

function collectTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "g");
  return xml.match(re) ?? [];
}

function collectAllMatches(xml: string, regex: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(xml)) !== null) {
    if (m[1]) out.push(m[1].trim());
  }
  return out;
}

function pickTagText(xml: string, pattern: string): string | null {
  const re = new RegExp(pattern);
  const m = xml.match(re);
  return m && m[1] ? m[1].trim() : null;
}

function pickAttribute(xml: string, regex: RegExp): string | null {
  const m = xml.match(regex);
  return m && m[1] ? m[1].trim() : null;
}

function formatHl7Date(value: string | null): string | null {
  if (!value) return null;
  // HL7 dates are YYYYMMDD or YYYYMMDDHHMMSS
  const m = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return value;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
