/**
 * BlackRoad Gateway — Entry Point
 * Tokenless AI provider gateway with task marketplace + PS-SHA∞ memory.
 */

import http from "http";
import { URL } from "url";
import { RateLimiter } from "./ratelimit.js";
import { route } from "./routes.js";
import { taskStore, memoryChain } from "./storage.js";
import { auditLog } from "./audit.js";

const PORT = parseInt(process.env.BLACKROAD_GATEWAY_PORT ?? "8787");
const BIND = process.env.BLACKROAD_GATEWAY_BIND ?? "127.0.0.1";
const limiter = new RateLimiter({ maxRequests: 100, windowMs: 60_000 });

// ── Request helpers ───────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}")); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "X-Powered-By": "BlackRoad Gateway",
  });
  res.end(body);
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  const clientId = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";

  // CORS preflight
  if (method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization" }); res.end(); return; }

  // Rate limit
  if (!limiter.allow(clientId)) {
    json(res, 429, { error: "rate_limited", remaining: 0 });
    return;
  }

  // ── Routes ────────────────────────────────────────────────────────────────

  // Health
  if (path === "/health" && method === "GET") {
    json(res, 200, {
      status: "ok",
      version: "1.0.0",
      uptime: process.uptime(),
      memory: process.memoryUsage().heapUsed,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Agents list
  if (path === "/agents" && method === "GET") {
    const agents = [
      { id: "LUCIDIA", type: "reasoning", status: "online", role: "Philosopher" },
      { id: "ALICE",   type: "worker",    status: "online", role: "Executor" },
      { id: "OCTAVIA", type: "devops",    status: "online", role: "Operator" },
      { id: "PRISM",   type: "analytics", status: "online", role: "Analyst" },
      { id: "ECHO",    type: "memory",    status: "online", role: "Librarian" },
      { id: "CIPHER",  type: "security",  status: "online", role: "Guardian" },
    ];
    json(res, 200, { agents, total: agents.length });
    return;
  }

  // Tasks
  if (path === "/tasks") {
    if (method === "GET") {
      const status = url.searchParams.get("status") as string | undefined;
      const priority = url.searchParams.get("priority") as string | undefined;
      const limit = parseInt(url.searchParams.get("limit") ?? "50");
      const offset = parseInt(url.searchParams.get("offset") ?? "0");
      const filters: Record<string, string> = {};
      if (status) filters.status = status;
      if (priority) filters.priority = priority;
      json(res, 200, taskStore.list(filters as never, limit, offset));
    } else if (method === "POST") {
      const body = await readBody(req) as Record<string, unknown>;
      const task = taskStore.add({ title: String(body.title ?? ""), description: String(body.description ?? ""), priority: (body.priority as never) ?? "medium", tags: (body.tags as string[]) ?? [], skills: (body.skills as string[]) ?? [] });
      await auditLog({ type: "task_created", taskId: task.id, clientId });
      json(res, 201, task);
    } else { json(res, 405, { error: "method_not_allowed" }); }
    return;
  }

  // Task claim/complete
  const taskMatch = path.match(/^\/tasks\/([^/]+)\/(claim|complete)$/);
  if (taskMatch && method === "POST") {
    const [, taskId, action] = taskMatch;
    const body = await readBody(req) as Record<string, string>;
    try {
      const task = action === "claim"
        ? taskStore.claim(taskId, body.agent ?? "unknown")
        : taskStore.complete(taskId, body.agent ?? "unknown", body.summary ?? "");
      await auditLog({ type: `task_${action}d`, taskId, agent: body.agent, clientId });
      json(res, 200, task);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      json(res, msg === "not_found" ? 404 : 409, { error: msg });
    }
    return;
  }

  // Memory
  if (path === "/memory") {
    if (method === "GET") {
      const type = url.searchParams.get("type") as string | undefined;
      const agent = url.searchParams.get("agent") as string | undefined;
      const limit = parseInt(url.searchParams.get("limit") ?? "20");
      const offset = parseInt(url.searchParams.get("offset") ?? "0");
      const filters: Record<string, unknown> = {};
      if (type) filters.type = type;
      if (agent) filters.agent = agent;
      const result = memoryChain.list(filters as never, limit, offset);
      json(res, 200, { ...result, chainValid: true });
    } else if (method === "POST") {
      const body = await readBody(req) as Record<string, unknown>;
      const entry = memoryChain.add({ content: String(body.content ?? ""), type: (body.type as never) ?? "observation", truthState: (body.truth_state as never) ?? 0, agent: (body.agent as string) ?? null, tags: (body.tags as string[]) ?? [] });
      json(res, 201, entry);
    } else { json(res, 405, { error: "method_not_allowed" }); }
    return;
  }

  if (path === "/memory/verify" && method === "GET") {
    json(res, 200, memoryChain.verify());
    return;
  }

  // AI provider proxy (/v1/chat, /v1/generate)
  if (path.startsWith("/v1/")) {
    await route(req, res, url, await readBody(req) as Record<string, unknown>, clientId);
    return;
  }

  json(res, 404, { error: "not_found", path });
});

server.listen(PORT, BIND, () => {
  console.log(`✓ BlackRoad Gateway listening on http://${BIND}:${PORT}`);
  console.log(`  Providers: ${[process.env.BLACKROAD_OLLAMA_URL && "ollama", process.env.BLACKROAD_ANTHROPIC_API_KEY && "anthropic", process.env.BLACKROAD_OPENAI_API_KEY && "openai"].filter(Boolean).join(", ") || "none configured"}`);
});

server.on("error", (err) => { console.error("Gateway error:", err); process.exit(1); });
