// The build id (api contract health `build`, cli contract `server.json`): a hash of the code a server runs and a
// web page is made from — src/core, src/server and src/web. A server whose build differs from the
// installation's is older code, and the page it serves would not match it.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const BUILD_DIRS = ["src/core", "src/server", "src/web"];

export function buildId(root) {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (!/\.test\.tsx?$/.test(name)) files.push(p);
    }
  };
  for (const d of BUILD_DIRS) walk(join(root, d));
  const h = createHash("sha256");
  for (const f of files) h.update(relative(root, f).replace(/\\/g, "/")).update("\0").update(readFileSync(f)).update("\0");
  return h.digest("hex").slice(0, 16);
}
