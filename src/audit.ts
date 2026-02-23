/**
 * Audit log — append-only record of all gateway activity.
 * Written to ~/.blackroad/gateway-audit.jsonl
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";

interface AuditEntry {
  event: string;
  timestamp: string;
  hash: string;
  prev_hash: string;
  [key: string]: unknown;
}

const AUDIT_FILE = path.join(os.homedir(), ".blackroad", "gateway-audit.jsonl");

export class AuditLog {
  private prevHash = "GENESIS";

  constructor() {
    const dir = path.dirname(AUDIT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Read last hash from existing log
    if (fs.existsSync(AUDIT_FILE)) {
      const lines = fs
        .readFileSync(AUDIT_FILE, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean);
      if (lines.length > 0) {
        try {
          const last = JSON.parse(lines[lines.length - 1]) as AuditEntry;
          this.prevHash = last.hash || "GENESIS";
        } catch {
          // corrupted last line, continue
        }
      }
    }
  }

  async log(data: Record<string, unknown>): Promise<AuditEntry> {
    const timestamp = new Date().toISOString();
    const content = JSON.stringify({ ...data, timestamp });

    const hash = createHash("sha256")
      .update(`${this.prevHash}:${content}:${Date.now()}`)
      .digest("hex");

    const entry: AuditEntry = {
      ...data,
      timestamp,
      hash,
      prev_hash: this.prevHash,
    };

    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n");
    this.prevHash = hash;

    return entry;
  }

  async verify(): Promise<{ valid: boolean; total: number; first_invalid?: string }> {
    if (!fs.existsSync(AUDIT_FILE)) return { valid: true, total: 0 };

    const lines = fs
      .readFileSync(AUDIT_FILE, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);

    let prevHash = "GENESIS";

    for (let i = 0; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]) as AuditEntry;
        if (entry.prev_hash !== prevHash) {
          return { valid: false, total: lines.length, first_invalid: entry.hash };
        }
        prevHash = entry.hash;
      } catch {
        return { valid: false, total: lines.length, first_invalid: `line_${i}` };
      }
    }

    return { valid: true, total: lines.length };
  }
}
