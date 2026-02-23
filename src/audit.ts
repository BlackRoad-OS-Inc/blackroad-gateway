/**
 * BlackRoad Gateway — Audit Logger
 * Append-only PS-SHA∞ audit log for all gateway operations.
 * Stores in Cloudflare KV or falls back to in-memory ring buffer.
 */

export interface AuditEntry {
  id: string;
  hash: string;
  prev_hash: string;
  timestamp: string;
  timestamp_ns: number;
  action: string;
  agent: string | null;
  model: string | null;
  status: number;
  latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
  error?: string;
}

const MAX_MEMORY_ENTRIES = 1000;
const memoryLog: AuditEntry[] = [];
let prevHash = "GENESIS";

async function sha256(data: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function logAuditEntry(
  action: string,
  opts: {
    agent?: string;
    model?: string;
    status?: number;
    latency_ms?: number;
    input_tokens?: number;
    output_tokens?: number;
    error?: string;
    kv?: KVNamespace;
  } = {}
): Promise<AuditEntry> {
  const ts_ns = Date.now() * 1_000_000;
  const content = JSON.stringify({ action, agent: opts.agent, model: opts.model, status: opts.status });
  const hash = await sha256(`${prevHash}:${content}:${ts_ns}`);

  const entry: AuditEntry = {
    id: `audit_${ts_ns}`,
    hash,
    prev_hash: prevHash,
    timestamp: new Date().toISOString(),
    timestamp_ns: ts_ns,
    action,
    agent: opts.agent ?? null,
    model: opts.model ?? null,
    status: opts.status ?? 200,
    latency_ms: opts.latency_ms ?? 0,
    input_tokens: opts.input_tokens,
    output_tokens: opts.output_tokens,
    error: opts.error,
  };

  prevHash = hash;

  // Store in KV if available
  if (opts.kv) {
    await opts.kv.put(`audit:${entry.id}`, JSON.stringify(entry), { expirationTtl: 86400 * 30 });
    // Update latest pointer
    await opts.kv.put("audit:latest", entry.id);
  }

  // Always keep in memory ring buffer
  memoryLog.push(entry);
  if (memoryLog.length > MAX_MEMORY_ENTRIES) memoryLog.shift();

  return entry;
}

export async function getRecentAuditLog(limit = 50, kv?: KVNamespace): Promise<AuditEntry[]> {
  if (kv) {
    // Try to read from KV
    const latest = await kv.get("audit:latest");
    if (latest) {
      // Walk the chain backwards — simplified: just return memory log for now
      return memoryLog.slice(-limit);
    }
  }
  return memoryLog.slice(-limit);
}

export async function verifyAuditChain(entries: AuditEntry[]): Promise<boolean> {
  let ph = "GENESIS";
  for (const e of entries) {
    const content = JSON.stringify({ action: e.action, agent: e.agent, model: e.model, status: e.status });
    const expected = await sha256(`${ph}:${content}:${e.timestamp_ns}`);
    if (expected !== e.hash) return false;
    ph = e.hash;
  }
  return true;
}
