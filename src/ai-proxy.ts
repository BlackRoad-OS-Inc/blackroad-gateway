/**
 * BlackRoad Gateway — AI Proxy (Node.js)
 * Routes /v1/chat, /v1/complete, and /v1/models to configured AI providers.
 * Provider credentials are read from environment variables — never from agents.
 */

import http from "http";
import { URL } from "url";

function json(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "X-Powered-By": "BlackRoad Gateway",
  });
  res.end(body);
}

// ── Provider selection ────────────────────────────────────────────────────────

function pickProvider(model: string): "openai" | "anthropic" | "ollama" {
  if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3")) return "openai";
  if (model.startsWith("claude-")) return "anthropic";
  return "ollama";
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

async function callOpenAI(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const apiKey = process.env.BLACKROAD_OPENAI_API_KEY;
  if (!apiKey) throw Object.assign(new Error("OpenAI provider not configured"), { status: 503 });

  const baseUrl = process.env.BLACKROAD_OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw Object.assign(new Error(`OpenAI error ${res.status}: ${err}`), { status: res.status });
  }
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

async function callAnthropic(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const apiKey = process.env.BLACKROAD_ANTHROPIC_API_KEY;
  if (!apiKey) throw Object.assign(new Error("Anthropic provider not configured"), { status: 503 });

  const messages = (body.messages as Array<{ role: string; content: string }>) ?? [];
  let system: string | undefined;
  const filtered = messages.filter(m => {
    if (m.role === "system") { system = m.content; return false; }
    return true;
  });

  const anthropicBody: Record<string, unknown> = {
    model:      body.model ?? "claude-3-haiku-20240307",
    max_tokens: body.max_tokens ?? 1024,
    messages:   filtered,
    temperature: body.temperature ?? 0.7,
  };
  if (system) anthropicBody.system = system;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(anthropicBody),
  });

  if (!res.ok) {
    const err = await res.text();
    throw Object.assign(new Error(`Anthropic error ${res.status}: ${err}`), { status: res.status });
  }
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Ollama ────────────────────────────────────────────────────────────────────

async function callOllama(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const baseUrl = process.env.BLACKROAD_OLLAMA_URL ?? "http://127.0.0.1:11434";
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model:    body.model ?? "qwen2.5:3b",
      messages: body.messages ?? [],
      stream:   false,
      options: {
        temperature: body.temperature ?? 0.7,
        num_predict: body.max_tokens ?? 2048,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw Object.assign(new Error(`Ollama error ${res.status}: ${err}`), { status: res.status });
  }

  // Normalise Ollama response to OpenAI-compatible shape
  const data = await res.json() as Record<string, unknown>;
  const msg = (data.message ?? {}) as { role?: string; content?: string };
  return {
    id:      `chatcmpl-ollama-${Date.now()}`,
    object:  "chat.completion",
    model:   body.model,
    choices: [{ index: 0, message: { role: msg.role ?? "assistant", content: msg.content ?? "" }, finish_reason: "stop" }],
    usage:   data.usage ?? null,
  };
}

// ── Models list ───────────────────────────────────────────────────────────────

async function listOllamaModels(): Promise<string[]> {
  try {
    const baseUrl = process.env.BLACKROAD_OLLAMA_URL ?? "http://127.0.0.1:11434";
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json() as { models?: { name: string }[] };
    return (data.models ?? []).map(m => m.name);
  } catch {
    return [];
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export async function routeAI(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  body: Record<string, unknown>,
  _clientId: string,
): Promise<void> {
  const path = url.pathname;

  // GET /v1/models
  if (path === "/v1/models" && req.method === "GET") {
    const ollamaModels = await listOllamaModels();
    const staticModels = [
      ...(process.env.BLACKROAD_OPENAI_API_KEY  ? ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"] : []),
      ...(process.env.BLACKROAD_ANTHROPIC_API_KEY ? ["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"] : []),
      ...ollamaModels,
    ];
    json(res, 200, {
      object: "list",
      data: staticModels.map(id => ({ id, object: "model" })),
    });
    return;
  }

  // POST /v1/chat  or  POST /v1/chat/completions (OpenAI-compat alias)
  if ((path === "/v1/chat" || path === "/v1/chat/completions") && req.method === "POST") {
    const model = String(body.model ?? "");
    if (!model) { json(res, 400, { error: "bad_request", message: "model is required" }); return; }

    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      json(res, 400, { error: "bad_request", message: "messages must be a non-empty array" });
      return;
    }

    const provider = pickProvider(model);
    try {
      let data: Record<string, unknown>;
      if (provider === "openai")     data = await callOpenAI(body);
      else if (provider === "anthropic") data = await callAnthropic(body);
      else                           data = await callOllama(body);

      json(res, 200, data);
    } catch (e: unknown) {
      const err = e as { message?: string; status?: number };
      json(res, err.status ?? 502, { error: "provider_error", message: err.message ?? "Unknown error" });
    }
    return;
  }

  // POST /v1/complete
  if (path === "/v1/complete" && req.method === "POST") {
    const model  = String(body.model ?? "qwen2.5:3b");
    const prompt = String(body.prompt ?? "");
    if (!prompt) { json(res, 400, { error: "bad_request", message: "prompt is required" }); return; }

    // Wrap as a chat request
    const chatBody = { ...body, messages: [{ role: "user", content: prompt }] };
    const provider = pickProvider(model);
    try {
      let data: Record<string, unknown>;
      if (provider === "openai")     data = await callOpenAI(chatBody);
      else if (provider === "anthropic") data = await callAnthropic(chatBody);
      else                           data = await callOllama(chatBody);

      json(res, 200, data);
    } catch (e: unknown) {
      const err = e as { message?: string; status?: number };
      json(res, err.status ?? 502, { error: "provider_error", message: err.message ?? "Unknown error" });
    }
    return;
  }

  json(res, 404, { error: "not_found", path });
}
