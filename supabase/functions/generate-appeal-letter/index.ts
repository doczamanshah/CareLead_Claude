// Deploy with:
// supabase functions deploy generate-appeal-letter --no-verify-jwt --project-ref ccpxoidlqsolzypmkiul
//
// Requires ANTHROPIC_API_KEY set as a Supabase Edge Function secret
// (should already be set from the extract-document function).

import { corsHeaders } from "../_shared/cors.ts";
import { logError } from "../_shared/logging.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const APPEAL_LETTER_SYSTEM_PROMPT = `You are a medical billing appeal letter assistant. Generate a professional appeal letter draft based on the denial information provided. This letter is a TEMPLATE that the patient will review and customize before sending. It is NOT legal advice.

The letter should include:
- Patient name placeholder: [PATIENT NAME]
- Date placeholder: [DATE]
- Insurance company name and address (from case data if available, otherwise placeholders)
- Member ID and claim number (from case parties if available)
- A clear statement that this is an appeal of a denied claim
- The denial reason and why the patient believes the denial should be overturned
- A request for reconsideration
- A list of enclosed documents placeholder
- Professional closing

Keep the tone professional but firm. Use plain language, not legalese. Include a disclaimer at the top: "DRAFT - Review and customize before sending. This is not legal advice."

Return the letter as plain text, not JSON.`;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callClaude(
  anthropicApiKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ text: string } | { error: string; status: number }> {
  const resp = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    }),
  });

  if (!resp.ok) {
    await resp.text().catch(() => undefined);
    logError("generate-appeal-letter.claude_error", undefined, { status: resp.status });
    return { error: `Claude API error: ${resp.status}`, status: 502 };
  }

  const result = await resp.json();
  const textBlock = result.content?.find(
    (b: { type: string }) => b.type === "text",
  );
  if (!textBlock?.text) {
    return { error: "Empty response from Claude API", status: 502 };
  }
  return { text: textBlock.text };
}

function buildUserPrompt(params: {
  denialRecord: Record<string, unknown> | null;
  billingCase: Record<string, unknown> | null;
  caseParties: Record<string, unknown> | null;
}): string {
  const { denialRecord, billingCase, caseParties } = params;

  const denialCategory = (denialRecord?.category as string | null) ?? "not specified";
  const denialReason = (denialRecord?.denial_reason as string | null) ?? "not provided";
  const deadline = (denialRecord?.deadline as string | null) ?? "not specified";

  const providerName = (billingCase?.provider_name as string | null) ?? "[PROVIDER NAME]";
  const payerName = (billingCase?.payer_name as string | null) ?? "[INSURANCE COMPANY]";
  const serviceDateStart = (billingCase?.service_date_start as string | null) ?? null;
  const serviceDateEnd = (billingCase?.service_date_end as string | null) ?? null;
  const totalBilled = billingCase?.total_billed ?? null;
  const totalPatient = billingCase?.total_patient_responsibility ?? null;

  const claimNumber = (caseParties?.claim_number as string | null) ?? "[CLAIM NUMBER]";
  const memberId = (caseParties?.member_id as string | null) ?? "[MEMBER ID]";
  const planName = (caseParties?.plan_name as string | null) ?? null;
  const groupNumber = (caseParties?.group_number as string | null) ?? null;

  let dateOfServiceLine = "Date of service: [DATE]";
  if (serviceDateStart) {
    if (serviceDateEnd && serviceDateEnd !== serviceDateStart) {
      dateOfServiceLine = `Dates of service: ${serviceDateStart} to ${serviceDateEnd}`;
    } else {
      dateOfServiceLine = `Date of service: ${serviceDateStart}`;
    }
  }

  return `Please generate an appeal letter draft using the following information:

## Denial Information
- Denial category: ${denialCategory}
- Denial reason: ${denialReason}
- Appeal deadline: ${deadline}

## Case Information
- Healthcare provider: ${providerName}
- Insurance company (payer): ${payerName}
- ${dateOfServiceLine}
- Total billed: ${totalBilled != null ? `$${totalBilled}` : "[AMOUNT]"}
- Patient responsibility: ${totalPatient != null ? `$${totalPatient}` : "[AMOUNT]"}

## Member & Claim Details
- Member ID: ${memberId}
- Claim number: ${claimNumber}
${planName ? `- Plan name: ${planName}` : ""}
${groupNumber ? `- Group number: ${groupNumber}` : ""}

Generate the appeal letter now as plain text. Remember to include the DRAFT disclaimer at the top.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { caseId, profileId, denialRecord, billingCase, caseParties } = body;

    if (!caseId || !profileId) {
      return jsonResponse(
        { error: "caseId and profileId are required" },
        400,
      );
    }

    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500);
    }

    const userPrompt = buildUserPrompt({
      denialRecord: denialRecord ?? null,
      billingCase: billingCase ?? null,
      caseParties: caseParties ?? null,
    });

    const claudeResult = await callClaude(
      anthropicApiKey,
      APPEAL_LETTER_SYSTEM_PROMPT,
      userPrompt,
    );

    if ("error" in claudeResult) {
      return jsonResponse({ error: "Letter generation failed" }, claudeResult.status);
    }

    return jsonResponse({ letter: claudeResult.text });
  } catch (err) {
    logError("generate-appeal-letter.unhandled", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
