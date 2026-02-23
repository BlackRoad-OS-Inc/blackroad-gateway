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
  GATEWAY_AUTH_SECRET?: string;   // shared secret for HMAC-SHA256 JWT signing
  CACHE?: KVNamespace;
  AUDIT_LOG?: KVNamespace;
}

// ── Auth helpers ─────────────────────────────────────────────────────────────

/** Public routes that don't require authentication. */
const PUBLIC_PATHS = new Set(["/health", "/ready", "/openapi.json"]);

/**
 * Verify a HS256 JWT using the Web Crypto API (available in CF Workers).
 * Returns the decoded payload or null if invalid/expired.
 */
async function verifyJWT(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;

    // Import signing key
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false, ["verify"],
    );

    // Verify signature
    const data = enc.encode(`${headerB64}.${payloadB64}`);
    const sig = Uint8Array.from(atob(sigB64.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sig, data);
    if (!valid) return null;

    // Decode payload
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Extract and verify the Bearer token from the Authorization header.
 * Returns the payload if valid, or a 401 Response if not.
 */
async function requireAuth(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Record<string, unknown> | Response> {
  // No secret configured → warn but allow (dev mode)
  if (!env.GATEWAY_AUTH_SECRET) {
    return { sub: "anonymous", role: "admin", dev: true };
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return Response.json(
      { error: "unauthorized", message: "Missing Authorization: Bearer <token>" },
      { status: 401, headers: cors },
    );
  }

  const payload = await verifyJWT(token, env.GATEWAY_AUTH_SECRET);
  if (!payload) {
    return Response.json(
      { error: "unauthorized", message: "Invalid or expired token" },
      { status: 401, headers: cors },
    );
  }
  return payload;
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

  // ── Authentication ──────────────────────────────
  let authPayload: Record<string, unknown> = {};
  if (!PUBLIC_PATHS.has(url.pathname)) {
    const result = await requireAuth(request, env, cors);
    if (result instanceof Response) return result;
    authPayload = result;
  }

  // ── Ready ────────────────────────────────────────
  if (url.pathname === "/ready") {
    return Response.json({ status: "ready", timestamp: new Date().toISOString() }, { headers: cors });
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
