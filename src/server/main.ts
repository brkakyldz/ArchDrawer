import { randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { createApp, envelopeError } from "./app";
import { loadConfig } from "./config";
import { writeAtomic } from "./files";
import { RunManager } from "./runs";
import { ScanManager } from "./scans";
import { serverFile } from "./serverfile";
import { Store } from "./store";
import { ClaudeEngine } from "./engines/claude";
import { CodexEngine } from "./engines/codex";
import { FixtureEngine } from "./engines/fixture";
import { sweepReviseFolders } from "./engines/revise";
import type { Engine } from "./engines/types";

const config = loadConfig();
const store = new Store(config.dataDir);
const runs = new RunManager(store, { timeoutMs: config.runTimeoutMs });
const scans = new ScanManager(config.dataDir, { timeoutMs: config.runTimeoutMs });
const factories: Record<string, () => Engine> = {
  claude: () => new ClaudeEngine(),
  codex: () => new CodexEngine(),
  fixture: () => new FixtureEngine(config.fixtureStepMs),
};
const engines = new Map<string, Engine>();
for (const id of config.engines) {
  if (factories[id]) engines.set(id, factories[id]());
  else console.warn(`Ignoring unknown engine "${id}" in ARCHDRAW_ENGINES`);
}
const token = randomBytes(24).toString("hex");
const infoFile = serverFile(config.dataDir);

const shutdown = () => {
  runs.cancelAll();
  scans.cancelAll();
  store.close();
  try {
    // Remove server.json only when it is still ours (a newer server may have replaced it).
    if (JSON.parse(readFileSync(infoFile, "utf8")).pid === process.pid) rmSync(infoFile, { force: true });
  } catch { /* already gone */ }
  server.close();
  process.exit(0);
};

const app = createApp({ config, store, runs, scans, engines, token, onShutdown: shutdown });

// The envelope's Host/Origin check runs before the adapter: a Host such as "127.0.0.1:4317.evil.example"
// is not a valid URL authority, and the adapter would answer 400 instead of the contract's 403.
const listener = getRequestListener(app.fetch);
const server = createServer((req, res) => {
  const refused = envelopeError(config.port, req.headers.host, req.headers.origin);
  if (refused) {
    res.writeHead(403, { "Content-Type": "application/json" }).end(JSON.stringify({ error: refused }));
    return;
  }
  void listener(req, res);
});
server.listen(config.port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${config.port}`;
  writeAtomic(infoFile, JSON.stringify({ port: config.port, pid: process.pid, token, version: config.version, build: config.build }, null, 2) + "\n", 0o600);
  store.watch();
  // Once the port is ours: the images a killed server's second looks left behind go; a live server's stay.
  sweepReviseFolders(config.dataDir);
  console.log(`archdrawer listening on ${url}`);
  console.log(`Data: ${config.dataDir} · engines: ${[...engines.keys()].join(", ") || "none"}`);
});
server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE" ? `Port ${config.port} is in use. Set PORT to another port.` : e.message);
  process.exit(1);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
