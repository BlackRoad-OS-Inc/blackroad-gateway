/**
 * Anthropic Claude provider.
 * Requires: BLACKROAD_ANTHROPIC_API_KEY env var (gateway only, never in agents)
 */

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

const ANTHROPIC_API = "https://api.anthropic.com/v1";
const API_VERSION = "2023-06-01";

export class AnthropicProvider {
  private apiKey: string;

  constructor() {
    const key = process.env.BLACKROAD_ANTHROPIC_API_KEY;
    if (!key) throw new Error("BLACKROAD_ANTHROPIC_API_KEY not set in gateway environment");
    this.apiKey = key;
  }

  private headers() {
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": API_VERSION,
      "content-type": "application/json",
    };
  }

  async chat(
    model: string,
    messages: AnthropicMessage[],
    opts: { temperature?: number; max_tokens?: number } = {}
  ): Promise<Record<string, unknown>> {
    // Separate system message if present
    let system: string | undefined;
    const filteredMessages = messages.filter((m) => {
      if (m.role === "system") {
        system = m.content;
        return false;
      }
      return true;
    });

    const body: Record<string, unknown> = {
      model: model || "claude-3-5-sonnet-latest",
      messages: filteredMessages,
      max_tokens: opts.max_tokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
    };
    if (system) body.system = system;

    const res = await fetch(`${ANTHROPIC_API}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic error ${res.status}: ${err}`);
    }

    const data = await res.json() as {
      content: { type: string; text: string }[];
      usage: { input_tokens: number; output_tokens: number };
    };

    // Normalize to Ollama-compatible format for consistency
    return {
      model,
      message: {
        role: "assistant",
        content: data.content.find((c) => c.type === "text")?.text || "",
      },
      prompt_eval_count: data.usage.input_tokens,
      eval_count: data.usage.output_tokens,
    };
  }

  async *chatStream(
    model: string,
    messages: AnthropicMessage[],
    opts: { temperature?: number; max_tokens?: number } = {}
  ): AsyncGenerator<Record<string, unknown>> {
    let system: string | undefined;
    const filteredMessages = messages.filter((m) => {
      if (m.role === "system") { system = m.content; return false; }
      return true;
    });

    const body: Record<string, unknown> = {
      model: model || "claude-3-5-sonnet-latest",
      messages: filteredMessages,
      max_tokens: opts.max_tokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
      stream: true,
    };
    if (system) body.system = system;

    const res = await fetch(`${ANTHROPIC_API}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Anthropic stream error: ${res.status}`);
    if (!res.body) throw new Error("No response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data) as {
            type: string;
            delta?: { text?: string };
          };
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            yield {
              message: { role: "assistant", content: parsed.delta.text },
              done: false,
            };
          }
        } catch {
          // skip
        }
      }
    }
  }
}
