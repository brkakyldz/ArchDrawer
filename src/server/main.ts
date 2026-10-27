import { randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { createApp, envelopeError } from "./app";
import { loadConfig, startupLine } from "./config";
import { writeAtomic } from "./files";
import { FolderPicker } from "./picker";
import { RunManager } from "./runs";
import { ScanManager } from "./scans";
import { serverFile } from "./serverfile";
import { Store } from "./store";
import { ClaudeEngine } from "./engines/claude";
import { CodexEngine } from "./engines/codex";
import { FixtureEngine } from "./engines/fixture";
import { isRunning, sweepReviseFolders } from "./engines/revise";
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
const picker = new FolderPicker({ testFile: config.testPicker });
const token = randomBytes(24).toString("hex");
const infoFile = serverFile(config.dataDir);

/** How long a stop waits for cancelled runs and scans to end before it exits anyway. */
const SETTLE_MS = 5_000;
let stopping = false;

const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  // No new request or run once stopping: `archdrawer stop` sees the server gone while it settles.
  server.close();
  server.closeIdleConnections();
  // An open folder dialog goes with the server (api contract, The folder dialog).
  picker.close();
  // A cancelled run removes its image (and Codex its temporary folder) once its engine has exited, so
  // the process waits for that, briefly. Whatever is left of this server's images then goes here
  // (api contract, The second look: removed however the run ends).
  let limit: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.all([runs.cancelAll(), scans.cancelAll()]),
    new Promise((r) => { limit = setTimeout(r, SETTLE_MS); }),
  ]);
  clearTimeout(limit);
  sweepReviseFolders(config.dataDir, (pid) => pid !== process.pid && isRunning(pid));
  store.close();
  try {
    // Remove server.json only when it is still ours (a newer server may have replaced it).
    if (JSON.parse(readFileSync(infoFile, "utf8")).pid === process.pid) rmSync(infoFile, { force: true });
  } catch { /* already gone */ }
  process.exit(0);
};

const app = createApp({ config, store, runs, scans, engines, token, picker, onShutdown: () => void shutdown() });

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
  console.log(startupLine(config, [...engines.keys()]));
});
server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE" ? `Port ${config.port} is in use. Set PORT to another port.` : e.message);
  process.exit(1);
});

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
