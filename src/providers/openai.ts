/**
 * OpenAI provider.
 * Requires: BLACKROAD_OPENAI_API_KEY env var (gateway only)
 */

export interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const OPENAI_API = "https://api.openai.com/v1";

export class OpenAIProvider {
  private apiKey: string;

  constructor() {
    const key = process.env.BLACKROAD_OPENAI_API_KEY;
    if (!key) throw new Error("BLACKROAD_OPENAI_API_KEY not set in gateway environment");
    this.apiKey = key;
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
        max_tokens: opts.max_tokens ?? 4096,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${err}`);
    }

    const data = await res.json() as {
      choices: { message: { role: string; content: string } }[];
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    return {
      model,
      message: data.choices[0]?.message || { role: "assistant", content: "" },
      prompt_eval_count: data.usage.prompt_tokens,
      eval_count: data.usage.completion_tokens,
    };
  }

  async *chatStream(
    model: string,
    messages: OpenAIMessage[],
    opts: { temperature?: number } = {}
  ): AsyncGenerator<Record<string, unknown>> {
    const res = await fetch(`${OPENAI_API}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages,
        temperature: opts.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!res.ok) throw new Error(`OpenAI stream error: ${res.status}`);
    if (!res.body) throw new Error("No response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data) as {
            choices: { delta?: { content?: string } }[];
          };
          const content = parsed.choices[0]?.delta?.content;
          if (content) {
            yield { message: { role: "assistant", content }, done: false };
          }
        } catch {
          // skip
        }
      }
    }
  }
}
