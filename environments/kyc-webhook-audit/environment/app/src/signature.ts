import { createHmac, timingSafeEqual } from "node:crypto";

export class SignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureError";
  }
}

/** Parses "t=1700000000,v1=abcdef..." into its parts. */
export function parseHeader(header: string | undefined): { timestamp: number; signatures: string[] } {
  if (!header) throw new SignatureError("missing signature header");
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t") timestamp = Number(value);
    else if (key === "v1" && value) signatures.push(value);
  }
  if (!Number.isInteger(timestamp) || signatures.length === 0) {
    throw new SignatureError("malformed signature header");
  }
  return { timestamp, signatures };
}

export function sign(secret: string, timestamp: number, body: Buffer | string): string {
  return createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
}

/**
 * Verifies a provider signature over the raw request body. Both of our
 * providers use the same scheme: HMAC-SHA256 over "<t>.<body>", hex encoded,
 * with the timestamp no more than `toleranceSec` away from `now`.
 */
export function verify(
  secret: string,
  header: string | undefined,
  body: Buffer,
  now: Date,
  toleranceSec = 300,
): void {
  const { timestamp, signatures } = parseHeader(header);
  const skew = Math.abs(now.getTime() / 1000 - timestamp);
  if (skew > toleranceSec) throw new SignatureError(`timestamp outside tolerance (${Math.round(skew)}s)`);
  const expected = Buffer.from(sign(secret, timestamp, body), "hex");
  const ok = signatures.some((candidate) => {
    const given = Buffer.from(candidate, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) throw new SignatureError("signature mismatch");
}
