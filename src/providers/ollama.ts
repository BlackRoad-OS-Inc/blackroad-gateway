/**
 * Ollama provider — local LLM inference via Ollama API.
 * Endpoint: http://localhost:11434 (default)
 */

export interface OllamaMessage {
  role: string;
  content: string;
}

export interface OllamaChatOptions {
  temperature?: number;
  num_predict?: number;
  top_p?: number;
  top_k?: number;
}

export class OllamaProvider {
  constructor(private baseUrl: string = "http://localhost:11434") {}

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      const data = await res.json() as { models?: { name: string }[] };
      return (data.models || []).map((m) => m.name);
    } catch {
      return [];
    }
  }

  async chat(
    model: string,
    messages: OllamaMessage[],
    opts: OllamaChatOptions = {}
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: opts.temperature ?? 0.7,
          num_predict: opts.num_predict ?? 2048,
          top_p: opts.top_p,
          top_k: opts.top_k,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama error: HTTP ${res.status}`);
    }

    return res.json();
  }

  async *chatStream(
    model: string,
    messages: OllamaMessage[],
    opts: OllamaChatOptions = {}
  ): AsyncGenerator<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: { temperature: opts.temperature ?? 0.7 },
      }),
    });

    if (!res.ok) throw new Error(`Ollama error: HTTP ${res.status}`);
    if (!res.body) throw new Error("No response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      for (const line of text.split("\n").filter(Boolean)) {
        try {
          yield JSON.parse(line);
        } catch {
          // incomplete JSON chunk
        }
      }
    }
  }

  async generate(
    model: string,
    prompt: string,
    opts: { stream?: boolean; temperature?: number } = {}
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: opts.stream ?? false,
        options: { temperature: opts.temperature ?? 0.7 },
      }),
    });

    if (!res.ok) throw new Error(`Ollama generate error: HTTP ${res.status}`);
    return res.json();
  }
}
