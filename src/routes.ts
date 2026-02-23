/**
 * BlackRoad Gateway — Route Handler
 *
 * All AI provider calls are proxied through here.
 * Agents NEVER hold API keys — this is the trust boundary.
 *
 * Env vars (gateway only):
 *   BLACKROAD_ANTHROPIC_API_KEY
 *   BLACKROAD_OPENAI_API_KEY
 *   BLACKROAD_OLLAMA_URL (default: http://localhost:11434)
 */

import { Router } from "./router";
import { AnthropicProvider } from "./providers/anthropic";
import { OpenAIProvider } from "./providers/openai";
import { OllamaProvider } from "./providers/ollama";
import { AuditLog } from "./audit";
import { RateLimiter } from "./ratelimit";

const router = new Router();
const audit = new AuditLog();
const limiter = new RateLimiter({ maxRequests: 100, windowMs: 60_000 });

// ── Provider routing ──────────────────────────────────────────────────────────

function selectProvider(model: string) {
  if (model.startsWith("claude")) return new AnthropicProvider();
  if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3"))
    return new OpenAIProvider();
  // Default: Ollama (local)
  return new OllamaProvider(process.env.BLACKROAD_OLLAMA_URL || "http://localhost:11434");
}

// ── Health ────────────────────────────────────────────────────────────────────

router.get("/health", async (_req, res) => {
  const ollama = new OllamaProvider(process.env.BLACKROAD_OLLAMA_URL || "http://localhost:11434");
  const ollamaOk = await ollama.health().catch(() => false);

  res.json({
    status: "ok",
    version: process.env.npm_package_version || "1.0.0",
    providers: {
      anthropic: !!process.env.BLACKROAD_ANTHROPIC_API_KEY,
      openai: !!process.env.BLACKROAD_OPENAI_API_KEY,
      ollama: ollamaOk,
    },
    timestamp: new Date().toISOString(),
  });
});

// ── Chat ──────────────────────────────────────────────────────────────────────

router.post("/chat", async (req, res) => {
  const { model = "qwen2.5:7b", messages, stream = false, options = {} } = req.body;

  // Rate limit
  const clientId = req.headers["x-agent-id"] || req.ip;
  if (!limiter.allow(clientId)) {
    return res.status(429).json({ error: "rate_limited", retry_after: 60 });
  }

  // Audit
  await audit.log({
    event: "chat",
    agent_id: clientId,
    model,
    message_count: messages?.length || 0,
    stream,
  });

  const provider = selectProvider(model);

  try {
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("X-Accel-Buffering", "no");

      for await (const chunk of provider.chatStream(model, messages, options)) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      const result = await provider.chat(model, messages, options);
      res.json(result);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "provider_error";
    await audit.log({ event: "chat_error", error: message, model });
    res.status(502).json({ error: "provider_error", message });
  }
});

// ── Generate (Ollama compat) ──────────────────────────────────────────────────

router.post("/generate", async (req, res) => {
  const { model = "qwen2.5:7b", prompt, stream = false } = req.body;
  const provider = new OllamaProvider(process.env.BLACKROAD_OLLAMA_URL || "http://localhost:11434");

  await audit.log({ event: "generate", model, prompt_length: prompt?.length || 0 });

  const result = await provider.generate(model, prompt, { stream });
  res.json(result);
});

// ── Models ────────────────────────────────────────────────────────────────────

router.get("/models", async (_req, res) => {
  const ollama = new OllamaProvider(process.env.BLACKROAD_OLLAMA_URL || "http://localhost:11434");
  const models = await ollama.listModels().catch(() => []);

  res.json({
    models,
    providers: {
      anthropic: !!process.env.BLACKROAD_ANTHROPIC_API_KEY
        ? ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"]
        : [],
      openai: !!process.env.BLACKROAD_OPENAI_API_KEY
        ? ["gpt-4o", "gpt-4o-mini", "o3-mini"]
        : [],
      ollama: models,
    },
  });
});

export default router;
