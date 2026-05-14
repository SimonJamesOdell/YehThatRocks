import { recordExternalApiUsage } from "@/lib/api-usage-telemetry";

type GroqModerationPayload = {
  shouldReview?: unknown;
  label?: unknown;
  reason?: unknown;
};

export type MagazineCommentModerationResult = {
  shouldReview: boolean;
  label: string;
  reason: string;
  source: "local" | "groq";
};

const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim() || "";

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

async function classifyWithGroq(comment: string): Promise<MagazineCommentModerationResult | null> {
  if (!GROQ_API_KEY) {
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
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are a strict moderation classifier. Output JSON only.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      void recordExternalApiUsage({
        provider: "groq",
        endpoint: "chat/completions",
        units: 1,
        success: false,
        statusCode: response.status,
        note: body.slice(0, 120) || null,
      });
      return null;
    }

    void recordExternalApiUsage({
      provider: "groq",
      endpoint: "chat/completions",
      units: 1,
      success: true,
      statusCode: response.status,
    });

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }

    const jsonText = extractJsonObject(content);
    if (!jsonText) {
      return null;
    }

    const parsed = JSON.parse(jsonText) as GroqModerationPayload;
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
      source: "groq",
    };
  } catch (error) {
    void recordExternalApiUsage({
      provider: "groq",
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

  const groq = await classifyWithGroq(comment);
  if (groq) {
    return groq;
  }

  return {
    shouldReview: false,
    label: "allowed",
    reason: "No policy trigger detected.",
    source: "local",
  };
}
