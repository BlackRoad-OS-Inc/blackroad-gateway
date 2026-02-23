/**
 * BlackRoad Gateway — In-Memory Storage
 * Task marketplace + PS-SHA∞ memory chain with optional persistence.
 */

import { createHash } from "crypto";
import { appendFileSync, existsSync, readFileSync } from "fs";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Priority = "low" | "medium" | "high" | "critical";
export type TaskStatus = "available" | "claimed" | "in_progress" | "completed" | "cancelled";
export type TruthState = 1 | 0 | -1;
export type MemoryType = "fact" | "observation" | "inference" | "commitment";

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  status: TaskStatus;
  agent: string | null;
  tags: string[];
  skills: string[];
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
  summary: string | null;
}

export interface MemoryEntry {
  hash: string;
  prevHash: string;
  content: string;
  type: MemoryType;
  truthState: TruthState;
  timestamp: string;
  agent: string | null;
  tags: string[];
  erased: boolean;
}

// ── Task Store ────────────────────────────────────────────────────────────────

export class TaskStore {
  private tasks = new Map<string, Task>();

  add(input: Omit<Task, "id" | "createdAt" | "claimedAt" | "completedAt" | "summary" | "status" | "agent">): Task {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const task: Task = {
      ...input,
      id,
      status: "available",
      agent: null,
      createdAt: new Date().toISOString(),
      claimedAt: null,
      completedAt: null,
      summary: null,
    };
    this.tasks.set(id, task);
    return task;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  list(filters: Partial<Pick<Task, "status" | "priority" | "agent">> = {}, limit = 50, offset = 0): { tasks: Task[]; total: number } {
    let all = [...this.tasks.values()].filter(t => !Object.entries(filters).some(([k, v]) => (t as Record<string,unknown>)[k] !== v));
    all.sort((a, b) => {
      const p = { critical: 4, high: 3, medium: 2, low: 1 };
      return (p[b.priority] ?? 0) - (p[a.priority] ?? 0);
    });
    return { tasks: all.slice(offset, offset + limit), total: all.length };
  }

  claim(id: string, agent: string): Task {
    const task = this.tasks.get(id);
    if (!task) throw new Error("not_found");
    if (task.status !== "available") throw new Error("not_available");
    task.status = "claimed";
    task.agent = agent;
    task.claimedAt = new Date().toISOString();
    return task;
  }

  complete(id: string, agent: string, summary = ""): Task {
    const task = this.tasks.get(id);
    if (!task) throw new Error("not_found");
    task.status = "completed";
    task.agent = agent;
    task.completedAt = new Date().toISOString();
    task.summary = summary;
    return task;
  }
}

// ── Memory Chain ──────────────────────────────────────────────────────────────

function psSha(prevHash: string, content: string): string {
  const ts = process.hrtime.bigint().toString();
  return createHash("sha256").update(`${prevHash}:${content}:${ts}`).digest("hex");
}

export class MemoryChain {
  private entries: MemoryEntry[] = [];
  private journalPath: string | null;

  constructor(journalPath: string | null = null) {
    this.journalPath = journalPath;
    if (journalPath && existsSync(journalPath)) {
      this._loadJournal(journalPath);
    }
  }

  private _loadJournal(path: string) {
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try { this.entries.push(JSON.parse(line)); } catch {}
    }
  }

  private _persist(entry: MemoryEntry) {
    if (this.journalPath) {
      appendFileSync(this.journalPath, JSON.stringify(entry) + "\n");
    }
  }

  add(input: Omit<MemoryEntry, "hash" | "prevHash" | "timestamp" | "erased">): MemoryEntry {
    const prevHash = this.entries.length > 0 ? this.entries[this.entries.length - 1].hash : "GENESIS";
    const entry: MemoryEntry = {
      ...input,
      hash: psSha(prevHash, input.content),
      prevHash,
      timestamp: new Date().toISOString(),
      erased: false,
    };
    this.entries.push(entry);
    this._persist(entry);
    return entry;
  }

  get(hash: string): MemoryEntry | undefined {
    return this.entries.find(e => e.hash === hash);
  }

  list(filters: Partial<Pick<MemoryEntry, "type" | "agent" | "truthState">> = {}, limit = 20, offset = 0) {
    const visible = this.entries.filter(e => !e.erased && !Object.entries(filters).some(([k, v]) => (e as Record<string,unknown>)[k] !== v));
    return { entries: visible.slice(offset, offset + limit), total: visible.length };
  }

  erase(hash: string): boolean {
    const entry = this.entries.find(e => e.hash === hash);
    if (!entry) return false;
    entry.erased = true;
    entry.content = `[ERASED:${createHash("sha256").update(entry.content).digest("hex").slice(0, 16)}]`;
    return true;
  }

  verify(): { valid: boolean; total: number; checked: number; firstInvalid: string | null } {
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const expectedPrev = i === 0 ? "GENESIS" : this.entries[i - 1].hash;
      if (e.prevHash !== expectedPrev) {
        return { valid: false, total: this.entries.length, checked: i, firstInvalid: e.hash };
      }
    }
    return { valid: true, total: this.entries.length, checked: this.entries.length, firstInvalid: null };
  }
}

// ── Singletons ────────────────────────────────────────────────────────────────

export const taskStore = new TaskStore();
export const memoryChain = new MemoryChain(process.env.MEMORY_JOURNAL ?? null);
