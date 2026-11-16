import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type KycStatus = "pending_kyc" | "manual_review" | "verified" | "rejected";

export type Customer = {
  id: string;
  email: string;
  name: string;
  country: string;
  plan: "personal" | "business";
  kyc_status: KycStatus;
  kyc_check_id: string | null;
  kyc_updated_at: string | null;
  balance_minor: number;
  processed_events: string[];
};

export class UnknownCustomer extends Error {
  constructor(id: string) {
    super(`no such customer: ${id}`);
    this.name = "UnknownCustomer";
  }
}

/** Allowed KYC transitions. A final decision can only be revisited by a person. */
const TRANSITIONS: Record<KycStatus, KycStatus[]> = {
  pending_kyc: ["manual_review", "verified", "rejected"],
  manual_review: ["verified", "rejected", "manual_review"],
  verified: [],
  rejected: [],
};

export function canMove(from: KycStatus, to: KycStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function dataDir(): string {
  return process.env.APP_DATA ?? join(import.meta.dirname, "..", "data");
}

export class CustomerStore {
  private readonly file: string;
  private customers: Map<string, Customer>;

  constructor(dir = dataDir()) {
    this.file = join(dir, "customers.json");
    const rows = JSON.parse(readFileSync(this.file, "utf8")) as Customer[];
    this.customers = new Map(rows.map((c) => [c.id, c]));
  }

  get(id: string): Customer {
    const customer = this.customers.get(id);
    if (!customer) throw new UnknownCustomer(id);
    return customer;
  }

  has(id: string): boolean {
    return this.customers.has(id);
  }

  all(): Customer[] {
    return [...this.customers.values()];
  }

  /** Records that a provider event was handled, so a redelivery is a no-op. */
  markProcessed(customer: Customer, eventId: string): void {
    customer.processed_events = [...customer.processed_events.slice(-49), eventId];
  }

  save(): void {
    const rows = [...this.customers.values()].sort((a, b) => a.id.localeCompare(b.id));
    writeFileSync(`${this.file}.tmp`, JSON.stringify(rows, null, 2) + "\n");
    renameSync(`${this.file}.tmp`, this.file);
  }
}
