import { llmChatCompletion } from "@/lib/llm-client";
import { recordExternalApiUsage } from "@/lib/api-usage-telemetry";

type LlmModerationPayload = {
  shouldReview?: unknown;
  label?: unknown;
  reason?: unknown;
};

export type MagazineCommentModerationResult = {
  shouldReview: boolean;
  label: string;
  reason: string;
  source: "local" | "deepseek";
};

const LLM_MODEL = process.env.LLM_MODEL?.trim() || "deepseek-v4-flash";
const ENABLE_MAGAZINE_COMMENT_LLM = process.env.ENABLE_MAGAZINE_COMMENT_LLM === "1";

const LOCAL_DOMAIN_POLICY_PATTERNS: Array<{ pattern: RegExp; label: string; reason: string }> = [
  {
    pattern: /\b(yehthatrocks|yeh\s*that\s*rocks|yeh)\b.{0,50}\b(slop|garbage|trash|delete|worthless|ruined|awful|terrible)\b/i,
    label: "domain-derogatory",
    reason: "Contains derogatory language targeting YehThatRocks.",
  },
  {
    pattern: /\b(ai\s*(code\s*generation|generated)?\s*(slop|garbage|trash)|ai\s*slop)\b/i,
    label: "ai-derogatory",
    reason: "Contains derogatory language about AI-generated content.",
  },
  {
    pattern: /\b(delete\s+(this|yehthatrocks|the\s*site)|shut\s*(down|it\s*down))\b/i,
    label: "domain-hostile",
    reason: "Contains hostile domain-targeting language.",
  },
];

function normalizeCommentText(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

function localPolicyClassify(comment: string): MagazineCommentModerationResult | null {
  const normalized = normalizeCommentText(comment);

  for (const rule of LOCAL_DOMAIN_POLICY_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      return {
        shouldReview: true,
        label: rule.label,
        reason: rule.reason,
        source: "local",
      };
    }
  }

  return null;
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

async function classifyWithLlm(comment: string): Promise<MagazineCommentModerationResult | null> {
  if (!ENABLE_MAGAZINE_COMMENT_LLM) {
    return null;
  }

  const prompt = [
    "Classify this user comment for domain policy moderation.",
    "Return JSON only with keys: shouldReview(boolean), label(string), reason(string).",
    "Set shouldReview=true when comment is derogatory/hostile toward YehThatRocks or AI code generation/AI slop.",
    "If uncertain, set shouldReview=false with a brief reason.",
    `comment: ${comment}`,
  ].join("\n");

  try {
    const result = await llmChatCompletion({
      model: LLM_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are a strict moderation classifier. Output JSON only.",
        },
        { role: "user", content: prompt },
      ],
    });

    if (!result) {
      void recordExternalApiUsage({
        provider: "deepseek",
        endpoint: "chat/completions",
        units: 1,
        success: false,
        statusCode: null,
        note: "No LLM provider configured",
      });
      return null;
    }

    void recordExternalApiUsage({
      provider: result.provider,
      endpoint: "chat/completions",
      units: 1,
      success: true,
      statusCode: 200,
    });

    const content = result?.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }

    const jsonText = extractJsonObject(content);
    if (!jsonText) {
      return null;
    }

    const parsed = JSON.parse(jsonText) as LlmModerationPayload;
    const shouldReview = parsed.shouldReview === true;
    const label = typeof parsed.label === "string" && parsed.label.trim()
      ? parsed.label.trim().slice(0, 80)
      : shouldReview
        ? "review-required"
        : "allowed";
    const reason = typeof parsed.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim().slice(0, 500)
      : shouldReview
        ? "Flagged by classifier."
        : "No policy trigger detected by classifier.";

    return {
      shouldReview,
      label,
      reason,
      source: "deepseek",
    };
  } catch (error) {
    void recordExternalApiUsage({
      provider: "deepseek",
      endpoint: "chat/completions",
      units: 1,
      success: false,
      statusCode: null,
      note: error instanceof Error ? error.message.slice(0, 120) : "request-error",
    });
    return null;
  }
}

export async function classifyMagazineComment(comment: string): Promise<MagazineCommentModerationResult> {
  const local = localPolicyClassify(comment);
  if (local) {
    return local;
  }

  const result = await classifyWithLlm(comment);
  if (result) {
    return result;
  }

  return {
    shouldReview: false,
    label: "allowed",
    reason: "No policy trigger detected.",
    source: "local",
  };
}
