/**
 * OpenAI provider.
 * API key is passed in via constructor from the CF Worker env (never hardcoded).
 */

export interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const OPENAI_API = "https://api.openai.com/v1";

export class OpenAIProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("BLACKROAD_OPENAI_API_KEY not set in gateway environment");
    this.apiKey = apiKey;
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async chat(
    model: string,
    messages: OpenAIMessage[],
    opts: { temperature?: number; max_tokens?: number } = {}
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${OPENAI_API}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.max_tokens ?? 1024,
      }),
    });
    return res.json() as Promise<Record<string, unknown>>;
  }

  async streamChat(
    model: string,
    messages: OpenAIMessage[],
    opts: { temperature?: number; max_tokens?: number } = {}
  ): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch(`${OPENAI_API}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.max_tokens ?? 1024,
        stream: true,
      }),
    });
    if (!res.body) throw new Error("No response body from OpenAI");
    return res.body;
  }
}
