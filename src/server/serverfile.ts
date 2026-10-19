import { readFileSync } from "node:fs";
import { join } from "node:path";

/** `<dataDir>/server.json` of a running server (cli contract). */
export interface ServerInfo { port: number; pid: number; token: string; version: string }

export const serverFile = (dataDir: string) => join(dataDir, "server.json");

export function readServerInfo(dataDir: string): ServerInfo | null {
  try {
    const s = JSON.parse(readFileSync(serverFile(dataDir), "utf8"));
    return Number.isInteger(s.port) && Number.isInteger(s.pid) && typeof s.token === "string" ? s : null;
  } catch {
    return null;
  }
}
