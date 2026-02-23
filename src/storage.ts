/**
 * BlackRoad Gateway — KV Storage Layer
 * Abstracts memory persistence behind a consistent interface.
 * Backs memory entries with PS-SHA∞ hash chaining.
 */

export interface MemoryEntry {
  key: string;
  value: unknown;
  hash: string;
  prev_hash: string;
  truth_state: 1 | 0 | -1;
  timestamp_ns: number;
  erased?: boolean;
}

let _prevHash = "GENESIS";
let _kv: KVNamespace | null = null;
const _memoryStore = new Map<string, MemoryEntry>();

export function setKV(kv: KVNamespace) { _kv = kv; }

async function sha256(data: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function memoryWrite(
  key: string, value: unknown, truth_state: 1 | 0 | -1 = 0
): Promise<MemoryEntry> {
  const ts = Date.now() * 1_000_000;
  const content = JSON.stringify(value);
  const hash = await sha256(`${_prevHash}:${key}:${content}:${ts}`);
  const entry: MemoryEntry = { key, value, hash, prev_hash: _prevHash, truth_state, timestamp_ns: ts };
  _prevHash = hash;
  _memoryStore.set(key, entry);
  if (_kv) await _kv.put(`mem:${key}`, JSON.stringify(entry));
  return entry;
}

export async function memoryRead(key: string): Promise<MemoryEntry | null> {
  if (_kv) {
    const raw = await _kv.get(`mem:${key}`);
    if (raw) return JSON.parse(raw) as MemoryEntry;
  }
  return _memoryStore.get(key) ?? null;
}

export async function memoryList(): Promise<MemoryEntry[]> {
  if (_kv) {
    const list = await _kv.list({ prefix: "mem:" });
    const entries = await Promise.all(
      list.keys.map(k => _kv!.get(k.name).then(v => v ? JSON.parse(v) as MemoryEntry : null))
    );
    return entries.filter(Boolean) as MemoryEntry[];
  }
  return Array.from(_memoryStore.values());
}

export async function memoryErase(key: string): Promise<boolean> {
  const entry = await memoryRead(key);
  if (!entry) return false;
  const erasedHash = await sha256(JSON.stringify(entry.value));
  const erased: MemoryEntry = {
    ...entry,
    value: `[ERASED:${erasedHash}]`,
    erased: true,
    truth_state: -1,
  };
  _memoryStore.set(key, erased);
  if (_kv) await _kv.put(`mem:${key}`, JSON.stringify(erased));
  return true;
}
