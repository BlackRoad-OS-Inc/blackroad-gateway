/**
 * BlackRoad Gateway — HTTP Routes
 * Registers all route handlers on the Hono/fetch-based router.
 */
import { logAuditEntry } from "./audit.js";
import { memoryWrite, memoryRead, memoryList, memoryErase } from "./storage.js";
import { checkRateLimit, rateLimitHeaders } from "./ratelimit.js";

export interface Env {
  BLACKROAD_ANTHROPIC_API_KEY?: string;
  BLACKROAD_OPENAI_API_KEY?: string;
  BLACKROAD_OLLAMA_URL?: string;
  CACHE?: KVNamespace;
  AUDIT_LOG?: KVNamespace;
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const start = Date.now();
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (request.method === "OPTIONS") return new Response(null, { headers: cors });

  // Rate limiting
  const routeKey = url.pathname.startsWith("/v1/chat") ? "chat"
    : url.pathname.startsWith("/memory") ? "memory"
    : url.pathname.startsWith("/agents") ? "agents" : "global";

  const rl = await checkRateLimit(ip, routeKey, env.CACHE);
  if (!rl.allowed) {
    return Response.json({ error: "Rate limit exceeded" }, {
      status: 429,
      headers: { ...cors, ...rateLimitHeaders(rl) }
    });
  }

  // ── Health ──────────────────────────────────────
  if (url.pathname === "/health") {
    return Response.json({
      status: "ok", version: "0.1.0",
      providers: [
        env.BLACKROAD_OLLAMA_URL ? "ollama" : null,
        env.BLACKROAD_ANTHROPIC_API_KEY ? "anthropic" : null,
        env.BLACKROAD_OPENAI_API_KEY ? "openai" : null,
      ].filter(Boolean),
      timestamp: new Date().toISOString(),
    }, { headers: cors });
  }

  // ── Memory ──────────────────────────────────────
  if (url.pathname === "/memory" && request.method === "GET") {
    const entries = await memoryList();
    return Response.json({ entries, count: entries.length }, { headers: { ...cors, ...rateLimitHeaders(rl) } });
  }
  if (url.pathname === "/memory" && request.method === "POST") {
    const { key, value, truth_state = 0 } = await request.json() as { key: string; value: unknown; truth_state?: 1|0|-1 };
    const entry = await memoryWrite(key, value, truth_state);
    await logAuditEntry("memory.write", { agent: null, model: null, status: 201, latency_ms: Date.now()-start, kv: env.AUDIT_LOG });
    return Response.json(entry, { status: 201, headers: cors });
  }
  if (url.pathname.startsWith("/memory/") && request.method === "GET") {
    const key = decodeURIComponent(url.pathname.slice(8));
    const entry = await memoryRead(key);
    if (!entry) return Response.json({ error: "Not found" }, { status: 404, headers: cors });
    return Response.json(entry, { headers: cors });
  }
  if (url.pathname.startsWith("/memory/") && request.method === "DELETE") {
    const key = decodeURIComponent(url.pathname.slice(8));
    const ok = await memoryErase(key);
    return Response.json({ erased: ok }, { status: ok ? 200 : 404, headers: cors });
  }

  // ── Agents ──────────────────────────────────────
  if (url.pathname === "/agents" && request.method === "GET") {
    const agents = [
      { id: "lucidia", name: "LUCIDIA", type: "logic",    status: "active", model: "llama3.2" },
      { id: "alice",   name: "ALICE",   type: "gateway",  status: "active", model: "llama3.2" },
      { id: "octavia", name: "OCTAVIA", type: "compute",  status: "active", model: "qwen2.5:7b" },
      { id: "prism",   name: "PRISM",   type: "vision",   status: "idle",   model: "llama3.2" },
      { id: "echo",    name: "ECHO",    type: "memory",   status: "active", model: "llama3.2" },
      { id: "cipher",  name: "CIPHER",  type: "security", status: "active", model: "llama3.2" },
    ];
    return Response.json({ agents, count: agents.length }, { headers: cors });
  }

  return Response.json({ error: "Not found" }, { status: 404, headers: cors });
}
