import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type AuditEntry = {
  at: string;
  type: string;
  actor: string;
  subject: string | null;
  details: Record<string, unknown>;
};

export function auditPath(): string {
  return process.env.AUDIT_LOG ?? "/var/tmp/audit/audit.ndjson";
}

/**
 * Appends one entry to the audit trail. The file is tailed by the log
 * shipper and indexed in Logline (see docs/operations.md).
 */
export function record(
  type: string,
  fields: { actor: string; subject?: string | null; details?: Record<string, unknown>; at: Date },
): AuditEntry {
  const entry: AuditEntry = {
    at: fields.at.toISOString(),
    type,
    actor: fields.actor,
    subject: fields.subject ?? null,
    details: fields.details ?? {},
  };
  const file = auditPath();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(entry) + "\n");
  return entry;
}
