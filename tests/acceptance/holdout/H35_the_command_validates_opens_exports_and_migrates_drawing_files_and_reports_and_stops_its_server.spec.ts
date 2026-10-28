import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { useProduct } from './server';
import { gitRepo, repoFiles, writeJSON, readJSON, cli, outLines, library, exists, readImage, expectSamePath, part, view } from './helpers';

const product = useProduct();

// The testing contract's minimal format 3 file.
const v3 = (title: string) => ({
  schema: 'archdraw/diagram@3', title,
  facts: {
    components: [
      { id: 'web', label: 'Web app', kind: 'client', sub: 'React', description: "The shop's pages.", files: [], items: [] },
      { id: 'api', label: 'Order API', kind: 'api', sub: '', description: 'Takes orders.', files: [], items: ['Validate order', 'Create order'] },
      { id: 'db', label: 'Orders DB', kind: 'data', sub: 'Postgres', description: 'Keeps orders.', files: [], items: [] },
    ],
    relations: [{ id: 'r1', from: 'web', to: 'api', label: 'POST /orders', style: 'call', both: true }, { id: 'r2', from: 'api', to: 'db', label: '', style: 'call', both: false }],
  },
  channels: { overview: { views: [{ id: 'overview', title: 'Overview', caption: { title: `How an order flows through ${title}`, lede: '' },
    nodes: [
      { id: 'web', facts: ['web'], form: 'card', icon: null, parent: null, detail: null, place: { row: 0, col: 0 } },
      { id: 'api', facts: ['api'], form: 'panel', icon: null, parent: null, detail: null, place: { row: 0, col: 1 } },
      { id: 'db', facts: ['db'], form: 'card', icon: null, parent: null, detail: null, place: { row: 1, col: 1 } }],
    edges: [{ from: 'web', to: 'api', relations: ['r1'], step: 1 }, { from: 'api', to: 'db', relations: ['r2'], step: 2 }] }] } },
});

// An agent session writes a drawing into a repository whose folder name looks like a shell command, then runs the command: it validates
// the file (and names the place of a mistake), opens it in the running editor server (written back as format 4, same id every time),
// writes the share image, converts an old file, drops a removed presentation channel with one warning, and reports and stops the server.
test('H35 [START-5 START-1 FILE-2 SAFE-1] the command validates, opens, exports and migrates drawing files in a folder named like a command, reuses the editor server, and reports and stops it', async ({ page }) => {
  const p = product();
  const repo = await gitRepo('cli', repoFiles, 'my shop & co; echo done');
  const file = join(repo.dir, 'docs', 'architecture.archdraw.json');
  await writeJSON(file, v3('Command shop'));

  const valid = await cli(p, ['validate', file]);
  expect(valid.code, valid.stderr).toBe(0);
  expect(outLines(valid).at(-1)).toMatch(/^valid/);
  expect((await readJSON(file)).schema, 'validate writes nothing').toBe('archdraw/diagram@3');

  // One mistake: the line names its place and what is allowed; exit 1. Not JSON: one line too.
  const broken = join(repo.dir, 'docs', 'broken.archdraw.json');
  const wrong = v3('Broken'); wrong.channels.overview.views[0].nodes[0].form = 'box';
  await writeJSON(broken, wrong);
  const invalid = await cli(p, ['validate', broken]);
  expect(invalid.code).toBe(1);
  expect(outLines(invalid).some(l => l.startsWith('ERROR choices[0].channels.overview.views[0].nodes[0].form: '))).toBe(true);
  expect(outLines(invalid).at(-1)).toMatch(/^1 error/);
  const notJson = join(repo.dir, 'docs', 'not.archdraw.json');
  await writeFile(notJson, '{ nope', 'utf8');
  const parsed = await cli(p, ['validate', notJson]);
  expect(parsed.code).toBe(1);
  expect(outLines(parsed).some(l => l.startsWith('ERROR json: '))).toBe(true);

  // Open: validated, written back as format 4, registered with the running server, the same id the second time.
  const opened = await cli(p, ['open', file, '--no-browser']);
  expect(opened.code, opened.stderr).toBe(0);
  const last = outLines(opened).at(-1)!;
  const match = last.match(/^Opened (.+) → http:\/\/127\.0\.0\.1:(\d+)\/d\/(d_[a-z0-9]+)$/);
  expect(match, last).not.toBeNull();
  expect(Number(match![2]), 'the running server is reused').toBe(p.port);
  await expectSamePath(match![1], file, 'the absolute file');
  const written = await readJSON(file);
  expect(written.schema).toBe('archdraw/diagram@4');
  expect(written.choices.map((c: any) => `${c.id}:${c.kind}`)).toEqual(['system:system']);
  expect(written.choices[0].facts.components.map((f: any) => f.label)).toEqual(['Web app', 'Order API', 'Orders DB']);
  expect((await library(p)).map(d => d.id)).toContain(match![3]);
  const again = await cli(p, ['open', file, '--no-browser']);
  expect(outLines(again).at(-1)).toContain(`/d/${match![3]}`);

  // The share image, next to the file by default, and at a format's size.
  const image = await cli(p, ['svg', file]);
  expect(image.code, image.stderr).toBe(0);
  const defaultOut = join(repo.dir, 'docs', 'architecture-overview-linkedin.svg');
  expect(await exists(defaultOut)).toBe(true);
  const feedOut = join(repo.dir, 'feed.svg');
  expect((await cli(p, ['svg', file, '--format', 'feed', '--out', feedOut])).code).toBe(0);
  const feed = await readImage(page, await readFile(feedOut, 'utf8'));
  expect([feed.width, feed.height, feed.format]).toEqual([1080, 1350, 'feed']);
  expect(feed.nodes.map(n => n.id).sort()).toEqual(['api', 'db', 'web']);
  expect((await cli(p, ['svg', file, '--format', 'bmp'])).code, 'a usage error').toBe(2);
  const noChoice = await cli(p, ['svg', file, '--choice', 'nope']);
  expect(noChoice.code).toBe(1);
  expect(noChoice.stderr).toMatch(/No choice "nope"/);
  expect((await cli(p, ['svg', file, '--dangerously-skip-permissions'])).code, 'an unknown option is a usage error').toBe(2);

  // A removed presentation channel: checked without it, then written back without it by open, with one warning.
  const withPresentation = join(repo.dir, 'docs', 'talk.archdraw.json');
  const talk = { ...written, id: undefined, title: 'Talk' };
  talk.choices = [{ ...written.choices[0], channels: { ...written.choices[0].channels,
    presentation: { views: [view('talk', 'Talk', [part('web')], [])], showSteps: false, outdated: [], steps: [{ id: 's1', parts: ['web'], text: 'Step 1', note: '' }] } } }];
  await writeJSON(withPresentation, talk);
  const checkedTalk = await cli(p, ['validate', withPresentation]);
  expect(checkedTalk.code, outLines(checkedTalk).join('\n')).toBe(0);
  const reopened = await cli(p, ['open', withPresentation, '--no-browser']);
  expect(reopened.code, reopened.stderr).toBe(0);
  const dropped = await readJSON(withPresentation);
  expect('presentation' in dropped.choices[0].channels).toBe(false);
  expect((dropped.warnings ?? []).filter((w: string) => /presentation channel was removed/.test(w))).toHaveLength(1);
  const current = await cli(p, ['migrate', file]);
  expect(outLines(current).at(-1)).toMatch(/already archdraw.diagram@4/);

  // Status and stop: this data directory's server.
  const status = await cli(p, ['status']);
  expect(status.code).toBe(0);
  expect(outLines(status).at(-1)).toMatch(new RegExp(`^running on http://127\\.0\\.0\\.1:${p.port} \\(pid \\d+\\)$`));
  expect((await cli(p, ['--version'])).stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  expect((await cli(p, [])).code, 'no arguments').toBe(2);
  expect((await cli(p, ['frobnicate'])).code, 'an unknown command').toBe(2);
  const stopped = await cli(p, ['stop']);
  expect(stopped.code).toBe(0);
  expect(outLines(stopped).at(-1)).toMatch(/stopped/);
  expect(outLines(await cli(p, ['status'])).at(-1)).toMatch(/not running/);
});
