/**
 * BlackRoad Gateway — Node.js Audit Logger
 * Append-only audit log to stdout / file for non-Worker deployments.
 */

export interface AuditRecord {
  timestamp?: string;
  type: string;
  taskId?: string;
  agent?: string;
  clientId?: string;
  [key: string]: unknown;
}

export async function logAuditEntry(record: AuditRecord): Promise<void> {
  const line = JSON.stringify({ ...record, timestamp: record.timestamp ?? new Date().toISOString() });
  process.stdout.write(line + "\n");
}
