/**
 * Anthropic Claude provider.
 * API key is passed in via constructor from the CF Worker env (never hardcoded).
 */

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

const ANTHROPIC_API = "https://api.anthropic.com/v1";
const API_VERSION = "2023-06-01";

export class AnthropicProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("BLACKROAD_ANTHROPIC_API_KEY not set in gateway environment");
    this.apiKey = apiKey;
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
      if ((m.role as string) === "system") {
        system = m.content;
        return false;
      }
      return true;
    });

    const body: Record<string, unknown> = {
      model: model || "claude-3-haiku-20240307",
      max_tokens: opts.max_tokens ?? 1024,
      messages: filteredMessages,
      temperature: opts.temperature ?? 0.7,
    };
    if (system) body.system = system;

    const res = await fetch(`${ANTHROPIC_API}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    return res.json() as Promise<Record<string, unknown>>;
  }

  async streamChat(
    model: string,
    messages: AnthropicMessage[],
    opts: { temperature?: number; max_tokens?: number } = {}
  ): Promise<ReadableStream<Uint8Array>> {
    let system: string | undefined;
    const filteredMessages = messages.filter((m) => {
      if ((m.role as string) === "system") { system = m.content; return false; }
      return true;
    });

    const body: Record<string, unknown> = {
      model: model || "claude-3-haiku-20240307",
      max_tokens: opts.max_tokens ?? 1024,
      messages: filteredMessages,
      temperature: opts.temperature ?? 0.7,
      stream: true,
    };
    if (system) body.system = system;

    const res = await fetch(`${ANTHROPIC_API}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.body) throw new Error("No response body from Anthropic");
    return res.body;
  }
}
