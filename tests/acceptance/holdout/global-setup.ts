// Builds the web client once, so no product start in a spec file has to (testing contract, *Start*: `npm start` builds it only when it is
// missing or older than its sources).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function globalSetup() {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: root, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true,
  });
}
