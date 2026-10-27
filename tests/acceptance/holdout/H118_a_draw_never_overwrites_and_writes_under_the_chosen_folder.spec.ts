import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gitRepo, plainFolder, projectFiles, writeFiles, writeExistingDrawing, token, checkFolder, drawFolder, scanFolder, scanRecord, startDraw, finishRun, register, listedDiagrams, cli, errorLines, samePath, exists, sorted } from './helpers';
import { getDocument } from './helpers-selections'; // a draw writes format 4: this gives the drawn choice in the shape the scenario was written in

const sixLines = (name: string) => Array.from({ length: 6 }, (_, i) => `// ${name} ${i + 1}`).join('\n') + '\n';

// The new file is `<folder>/docs/architecture.archdraw.json`, or the next free `architecture-<n>.archdraw.json` (n = 2 to 99);
// the app never overwrites a file, whatever it holds. The folder is the one chosen, so a subfolder of a repository gets its own
// docs folder while its facts' paths stay relative to the repository root, and a folder outside git is its own root.
test('H118 [START-4, READ-2, FILE-1, #181, #182] a draw takes the next free file name up to 99 and never replaces a file, a subfolder is drawn under its own docs folder with paths from the repository root, and a folder outside git is its own root', async ({ request }) => {
  test.setTimeout(90_000);
  const auth = await token(request);
  const project = await gitRepo('draw-names', { ...projectFiles, 'pkg/alpha.ts': sixLines('pa'), 'pkg/beta.ts': sixLines('pb'), 'pkg/gamma.ts': sixLines('pg') });
  const first = await writeExistingDrawing(project.dir); // the user's own drawing, never opened by the app
  const firstBytes = await readFile(first, 'utf8');
  const named = (n: number) => join(project.dir, 'docs', `architecture-${n}.archdraw.json`);

  const check = await checkFolder(request, auth, project.dir);
  expect(samePath(check.body.drawing, first)).toBe(true); // the home screen offers to open it

  // The first name is taken: the next ones are -2 and -3, whatever the focus and channel. One scan serves all three draws:
  // a finished scan is kept, so a draw can follow it at any time.
  const scan = await scanFolder(request, auth, project.dir);
  const drawn = async (focus: unknown, channel: string) => finishRun(request, await startDraw(request, auth, scan.id, focus, channel), 'succeeded', 120_000);
  const second = await drawn({ kind: 'option', option: 'o2' }, 'readme');
  expect(samePath(second.path, named(2)), second.path).toBe(true);
  const third = await drawn({ kind: 'whole' }, 'linkedin');
  expect(samePath(third.path, named(3)), third.path).toBe(true);
  const fourth = await drawn({ kind: 'typed', text: 'How the agent keeps its state' }, 'presentation');
  expect(samePath(fourth.path, named(4)), fourth.path).toBe(true);
  expect(await readFile(first, 'utf8'), 'the existing drawing is untouched').toBe(firstBytes);
  expect(samePath((await checkFolder(request, auth, project.dir)).body.drawing, first)).toBe(true);
  const kept = await scanRecord(request, scan.id); expect(kept.status).toBe('succeeded'); expect(kept.card).not.toBeNull();
  const listed = await listedDiagrams(request);
  for (const [n, run] of [[2, second], [3, third], [4, fourth]] as const) {
    const entry = listed.find(d => d.id === run.diagramId)!;
    expect(samePath(entry.path!, named(n))).toBe(true);
    expect((await cli(['validate', named(n)])).code, `architecture-${n} is a valid drawing`).toBe(0);
  }
  expect(new Set([second.diagramId, third.diagramId, fourth.diagramId]).size).toBe(3);
  expect(listed.some(d => d.path && samePath(d.path, first)), 'the file the app did not open is not registered').toBe(false);

  // A folder inside the repository: its own docs folder, facts relative to the repository root.
  const inner = join(project.dir, 'pkg');
  const sub = await drawFolder(request, auth, inner, { channel: 'linkedin' });
  const file = join(inner, 'docs', 'architecture.archdraw.json');
  expect(samePath(sub.run.path, file), sub.run.path).toBe(true); expect(samePath(sub.scan.root, project.dir)).toBe(true);
  const doc = await getDocument(request, sub.run.diagramId);
  expect(doc.title).toBe('pkg'); expect(samePath(doc.source!.path, project.dir)).toBe(true);
  expect(doc.facts.components.find(f => f.id === 'app')).toMatchObject({ files: ['pkg/alpha.ts'] });
  expect(doc.facts.components.find(f => f.id === 'agent')).toMatchObject({ files: ['pkg/beta.ts'], evidence: [{ file: 'pkg/beta.ts', lines: [1, 1] }] });
  const written = await cli(['validate', file]); expect(written.code, written.stdout + written.stderr).toBe(0); expect(errorLines(written)).toEqual([]);

  // Must not happen: a file written at the repository root's docs folder for the subfolder, or any tracked file changed.
  expect(await exists(join(project.dir, 'docs', 'architecture-5.archdraw.json'))).toBe(false);
  expect(sorted((await project.git(['status', '--porcelain'])).trim().split(/\r?\n/))).toEqual(['?? docs/', '?? pkg/docs/']);
  expect((await project.git(['diff', '--stat'])).trim()).toBe('');

  // The names run to 99, and whatever sits at a name, a drawing or not, is left as it is.
  const crowded = await gitRepo('draw-ninety-nine');
  const taken = 'This is not a drawing and is not replaced.\n';
  await writeExistingDrawing(crowded.dir);
  await writeFiles(crowded.dir, Object.fromEntries(Array.from({ length: 97 }, (_, i) => [`docs/architecture-${i + 2}.archdraw.json`, taken])));
  const last = await drawFolder(request, auth, crowded.dir, { channel: 'linkedin' });
  expect(samePath(last.run.path, join(crowded.dir, 'docs', 'architecture-99.archdraw.json')), last.run.path).toBe(true);
  for (let n = 2; n <= 98; n++) expect(await readFile(join(crowded.dir, 'docs', `architecture-${n}.archdraw.json`), 'utf8'), `architecture-${n} is untouched`).toBe(taken);
  expect(await exists(last.run.path)).toBe(true);

  // A folder outside git is its own root: the drawing's source is the folder, whatever the `docs` folder it writes into, and the
  // facts' paths are relative to it, also for a subfolder, which is a root of its own and not a part of the folder above it.
  const plain = await plainFolder('draw-plain', { ...projectFiles, 'pkg/alpha.ts': sixLines('qa'), 'pkg/beta.ts': sixLines('qb'), 'pkg/gamma.ts': sixLines('qg') });
  const outside = await drawFolder(request, auth, plain, { channel: 'readme' });
  expect(samePath(outside.run.path, join(plain, 'docs', 'architecture.archdraw.json')), outside.run.path).toBe(true);
  expect(samePath(outside.scan.root, plain)).toBe(true);
  const plainDoc = await getDocument(request, outside.run.diagramId);
  expect(samePath(plainDoc.source!.path, plain), plainDoc.source?.path).toBe(true);
  expect(plainDoc.facts.components.find(f => f.id === 'agent')).toMatchObject({ files: ['beta.ts'], evidence: [{ file: 'beta.ts', lines: [1, 1] }] });
  const again = await register(request, outside.run.path); // opening the written file again keeps the root
  expect(samePath((await getDocument(request, again.id)).source!.path, plain)).toBe(true);
  const nested = await drawFolder(request, auth, join(plain, 'pkg'), { channel: 'linkedin' });
  expect(samePath(nested.run.path, join(plain, 'pkg', 'docs', 'architecture.archdraw.json')), nested.run.path).toBe(true);
  expect(samePath(nested.scan.root, join(plain, 'pkg'))).toBe(true);
  const nestedDoc = await getDocument(request, nested.run.diagramId);
  expect(samePath(nestedDoc.source!.path, join(plain, 'pkg')), nestedDoc.source?.path).toBe(true);
  expect(nestedDoc.facts.components.find(f => f.id === 'agent')).toMatchObject({ files: ['beta.ts'] });
  const plainCheck = await cli(['validate', nested.run.path]); expect(plainCheck.code, plainCheck.stdout + plainCheck.stderr).toBe(0);
});
