import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { handle } from "./app.ts";

/**
 * Two ways in:
 *   node src/server.ts                       listen on $PORT (default 8080)
 *   node src/server.ts replay <request.json> [--now ISO]
 *       run one captured request through the router and print the response.
 *       request.json is {"method","path","headers",{"body"|"body_base64"}}.
 */
const [, , command, file, flag, nowArg] = process.argv;

if (command === "replay") {
  const captured = JSON.parse(readFileSync(file, "utf8"));
  const body = captured.body_base64 !== undefined
    ? Buffer.from(captured.body_base64, "base64")
    : Buffer.from(typeof captured.body === "string" ? captured.body : JSON.stringify(captured.body));
  const now = flag === "--now" && nowArg ? new Date(nowArg) : new Date();
  const res = handle({ method: captured.method, path: captured.path, headers: captured.headers ?? {}, body }, { now });
  process.stdout.write(JSON.stringify(res) + "\n");
} else {
  const port = Number(process.env.PORT ?? 8080);
  createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(",") : v;
      const out = handle({ method: req.method ?? "GET", path: (req.url ?? "/").split("?")[0], headers, body: Buffer.concat(chunks) });
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(JSON.stringify(out.body));
    });
  }).listen(port, () => console.log(`listening on ${port}`));
}
