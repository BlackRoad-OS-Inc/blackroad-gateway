/**
 * BlackRoad Gateway — Task Store + Memory Chain
 * In-process implementations used by the Node.js HTTP server (src/index.ts).
 */

import crypto from "node:crypto";

// ── Types ────────────────────────────────────────────────────────────────────

export type TaskPriority = "low" | "medium" | "high" | "critical";
export type TaskStatus   = "open" | "claimed" | "completed";
export type TruthState   = 1 | 0 | -1;
export type MemoryType   = "observation" | "decision" | "fact" | "error";

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  tags: string[];
  skills: string[];
  agent: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryEntry {
  id: string;
  content: string;
  type: MemoryType;
  truthState: TruthState;
  agent: string | null;
  tags: string[];
  hash: string;
  prevHash: string;
  timestamp: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function nanoid(): string {
  return crypto.randomBytes(8).toString("hex");
}

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// ── TaskStore ────────────────────────────────────────────────────────────────

export class TaskStore {
  private tasks = new Map<string, Task>();

  add(opts: {
    title: string;
    description: string;
    priority?: TaskPriority;
    tags?: string[];
    skills?: string[];
  }): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id:          `task_${nanoid()}`,
      title:       opts.title,
      description: opts.description,
      priority:    opts.priority ?? "medium",
      status:      "open",
      tags:        opts.tags ?? [],
      skills:      opts.skills ?? [],
      agent:       null,
      summary:     null,
      createdAt:   now,
      updatedAt:   now,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  list(
    filters: Partial<Pick<Task, "status" | "priority">>,
    limit = 50,
    offset = 0,
  ): { tasks: Task[]; total: number; limit: number; offset: number } {
    let items = Array.from(this.tasks.values());
    if (filters.status)   items = items.filter(t => t.status   === filters.status);
    if (filters.priority) items = items.filter(t => t.priority === filters.priority);
    const total = items.length;
    return { tasks: items.slice(offset, offset + limit), total, limit, offset };
  }

  claim(taskId: string, agent: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("not_found");
    if (task.status !== "open") throw new Error("already_claimed");
    const now = new Date().toISOString();
    const updated: Task = { ...task, status: "claimed", agent, updatedAt: now };
    this.tasks.set(taskId, updated);
    return updated;
  }

  complete(taskId: string, agent: string, summary: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("not_found");
    if (task.status === "completed") throw new Error("already_completed");
    const now = new Date().toISOString();
    const updated: Task = { ...task, status: "completed", agent, summary, updatedAt: now };
    this.tasks.set(taskId, updated);
    return updated;
  }
}

// ── MemoryChain ───────────────────────────────────────────────────────────────

export class MemoryChain {
  private entries: MemoryEntry[] = [];
  private prevHash = "GENESIS";

  add(opts: {
    content: string;
    type?: MemoryType;
    truthState?: TruthState;
    agent?: string | null;
    tags?: string[];
  }): MemoryEntry {
    const ts = new Date().toISOString();
    const hash = sha256(`${this.prevHash}:${opts.content}:${ts}`);
    const entry: MemoryEntry = {
      id:         `mem_${nanoid()}`,
      content:    opts.content,
      type:       opts.type ?? "observation",
      truthState: opts.truthState ?? 0,
      agent:      opts.agent ?? null,
      tags:       opts.tags ?? [],
      hash,
      prevHash:   this.prevHash,
      timestamp:  ts,
    };
    this.prevHash = hash;
    this.entries.push(entry);
    return entry;
  }

  list(
    filters: Partial<Pick<MemoryEntry, "type" | "agent">>,
    limit = 20,
    offset = 0,
  ): { entries: MemoryEntry[]; total: number; limit: number; offset: number } {
    let items = [...this.entries];
    if (filters.type)  items = items.filter(e => e.type  === filters.type);
    if (filters.agent) items = items.filter(e => e.agent === filters.agent);
    const total = items.length;
    return { entries: items.slice(offset, offset + limit), total, limit, offset };
  }

  verify(): { valid: boolean; length: number; tip: string } {
    let ph = "GENESIS";
    for (const e of this.entries) {
      const expected = sha256(`${ph}:${e.content}:${e.timestamp}`);
      if (expected !== e.hash) return { valid: false, length: this.entries.length, tip: e.id };
      ph = e.hash;
    }
    return { valid: true, length: this.entries.length, tip: this.prevHash };
  }
}
