/**
 * Shared LLM client — DeepSeek exclusively.
 *
 * All LLM backend services use DeepSeek (deepseek-v4-flash or deepseek-chat)
 * via the OpenAI-compatible chat completions API.
 */

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY?.trim() || undefined;
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1/chat/completions";

export type LlmProvider = "deepseek";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmChatCompletionParams = {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
};

export type LlmChatCompletionResponse = {
  provider: LlmProvider;
  model: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type LlmConfig = {
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
};

function resolveConfig(): LlmConfig | null {
  if (!DEEPSEEK_API_KEY) return null;

  return {
    provider: "deepseek",
    apiKey: DEEPSEEK_API_KEY,
    baseUrl: DEEPSEEK_BASE_URL,
  };
}

export async function llmChatCompletion(
  params: LlmChatCompletionParams,
): Promise<LlmChatCompletionResponse | null> {
  const config = resolveConfig();
  if (!config) return null;

  const response = await fetch(config.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: params.temperature,
      max_tokens: params.max_tokens,
      response_format: params.response_format,
      messages: params.messages,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  return {
    provider: config.provider,
    model: params.model,
    choices: payload.choices,
    usage: payload.usage,
  };
}

/**
 * Build a concise usage note for telemetry: "m=model pt=N ct=N tt=N"
 */
export function buildLlmTokenUsageNote(
  model: string,
  usage: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } | null | undefined,
): string {
  const promptTokens = Number(usage?.prompt_tokens ?? NaN);
  const completionTokens = Number(usage?.completion_tokens ?? NaN);
  const totalTokens = Number(usage?.total_tokens ?? NaN);

  const parts = [
    `m=${model}`,
    Number.isFinite(promptTokens) ? `pt=${promptTokens}` : null,
    Number.isFinite(completionTokens) ? `ct=${completionTokens}` : null,
    Number.isFinite(totalTokens) ? `tt=${totalTokens}` : null,
  ].filter((value): value is string => Boolean(value));

  return parts.join(" ").slice(0, 120);
}
