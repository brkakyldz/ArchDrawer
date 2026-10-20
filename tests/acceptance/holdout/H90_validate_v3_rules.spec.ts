import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { shop3, withLinkedIn, part, repo, writeJSON, cli, token, baseURL, type Doc3 } from './helpers';

const OVERVIEW = 'channels.overview.views[0]';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const valid = () => withLinkedIn(shop3('Rules shop'));

// Each case breaks one rule of the drawing contract, on its own, so another error cannot mask it. The pattern is what
// `archdrawer validate` must print (a documented path where the contract gives one, else the place to fix); the
// server's refusal carries the same `<path>: <message>` lines in `errors`.
const cases: { name: string; pattern: RegExp; break: (d: Doc3) => void }[] = [
  { name: 'form-not-a-form',
    pattern: new RegExp(`^ERROR ${escape(OVERVIEW)}\\.nodes\\[1\\]\\.form: "box" is not a form; use one of card, compact, panel, group$`, 'm'),
    break: d => { d.channels.overview.views![0].nodes[1].form = 'box'; } },
  { name: 'fact-kind', pattern: /^ERROR facts\.components\[0\]\.kind: .*actor.*client.*api.*service/m,
    break: d => { d.facts.components[0].kind = 'database'; } },
  { name: 'part-points-at-no-fact', pattern: new RegExp(`^ERROR ${escape(OVERVIEW)}\\.nodes\\[0\\]\\.facts`, 'm'),
    break: d => { d.channels.overview.views![0].nodes[0].facts = ['ghost']; } },
  { name: 'part-without-facts-property', pattern: new RegExp(`^ERROR ${escape(OVERVIEW)}\\.nodes\\[0\\]\\.facts`, 'm'),
    break: d => { delete (d.channels.overview.views![0].nodes[0] as Partial<{ facts: string[] }>).facts; } },
  { name: 'fact-no-overview-part-draws', pattern: /^ERROR (facts\.components\[2\]|channels\.overview)/m, // the LinkedIn channel still draws it
    break: d => { const v = d.channels.overview.views![0]; v.nodes = v.nodes.filter(n => n.id !== 'db'); v.edges = v.edges.filter(e => e.id !== 'e2'); } },
  { name: 'part-with-no-fact-and-no-own-text', pattern: new RegExp(`^ERROR ${escape(OVERVIEW)}\\.nodes\\[3\\]\\.(label|kind|description)`, 'm'),
    break: d => { d.channels.overview.views![0].nodes.push(part('frame', { facts: [] })); } },
  { name: 'own-label-too-long', pattern: new RegExp(`^ERROR ${escape(OVERVIEW)}\\.nodes\\[0\\]\\.label`, 'm'),
    break: d => { d.channels.overview.views![0].nodes[0].label = 'x'.repeat(49); } },
  { name: 'readme-holds-a-view', pattern: /^ERROR channels\.readme/m,
    break: d => { const copy = structuredClone(d.channels.overview.views![0]); copy.id = 'readme-view'; d.channels.readme = { views: [copy] }; } },
  { name: 'linkedin-holds-two-views', pattern: /^ERROR channels\.linkedin/m,
    break: d => { const copy = structuredClone(d.channels.linkedin!.views![0]); copy.id = 'second-post'; d.channels.linkedin!.views!.push(copy); } },
  { name: 'detail-outside-the-overview', pattern: /^ERROR channels\.linkedin\.views\[0\]\.nodes\[0\]\.detail/m,
    break: d => { d.channels.linkedin!.views![0].nodes[0].detail = 'overview'; } },
  { name: 'view-id-used-in-two-channels', pattern: /^ERROR channels\.(linkedin|overview)\.views\[\d\]\.id/m,
    break: d => { d.channels.linkedin!.views![0].id = 'overview'; } },
  { name: 'outdated-lists-an-id-twice', pattern: /^ERROR channels\.linkedin\.outdated/m,
    break: d => { d.channels.linkedin!.outdated = ['db', 'db']; } },
  { name: 'connection-shows-a-relation-between-other-parts', pattern: new RegExp(`^ERROR ${escape(OVERVIEW)}\\.edges\\[0\\]\\.relations`, 'm'),
    break: d => { d.channels.overview.views![0].edges[0].relations = ['r2']; } },
  { name: 'second-relation-on-one-pair', pattern: /^ERROR facts\.relations/m,
    break: d => { d.facts.relations!.push({ id: 'r3', from: 'web', to: 'api', label: '', style: 'call', both: false }); } },
  { name: 'fact-and-relation-share-an-id', pattern: /^ERROR facts\.(relations\[0\]|components\[0\])\.id/m,
    break: d => { d.facts.relations![0].id = 'web'; } },
  { name: 'file-outside-the-repository', pattern: /^ERROR facts\.components\[0\]\.files/m,
    break: d => { d.facts.components[0].files = ['../escape.ts']; } },
  { name: 'request-names-no-channel', pattern: /^ERROR requests\[0\]\.(channel|view)/m,
    break: d => { d.requests = [{ id: 'q1', text: 'Add a cache', channel: 'board', view: 'overview', at: '2026-10-13T12:00:00.000Z' }]; } },
  { name: 'schema-not-this-format', pattern: /^ERROR schema/m,
    break: d => { d.schema = 'archdraw/diagram@9'; } },
];

test('H90 [FILE-2, START-5, FILE-1] validate refuses every broken rule of the @3 file with its path and leaves the file alone, while a path missing from the repository only warns', async ({ request }) => {
  const folder = await repo('rules');
  const auth = await token(request);
  const everyLine = (result: { stdout: string; stderr: string }) => `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map(line => line.trimEnd());

  // The unbroken document is valid, so each refusal below is the doing of one rule.
  const fine = join(folder.dir, 'fine.json'); await writeJSON(fine, valid());
  const accepted = await cli(['validate', fine]); expect(accepted.code, accepted.stdout + accepted.stderr).toBe(0);
  expect(everyLine(accepted).some(line => /^ERROR /.test(line))).toBe(false);

  for (const rule of cases) {
    const candidate = valid(); rule.break(candidate);
    const path = join(folder.dir, `${rule.name}.json`); await writeJSON(path, candidate);
    const original = await readFile(path, 'utf8');
    for (const command of ['validate', 'open']) {
      const result = await cli([command, path, ...(command === 'open' ? ['--no-browser'] : [])]);
      const lines = everyLine(result);
      expect(result.code, `${rule.name}: ${command}`).toBe(1);
      expect(lines.join('\n'), `${rule.name}: ${command}`).toMatch(rule.pattern);
      expect(lines.filter(line => /^WARN /.test(line)), `${rule.name}: an invalid file prints no warnings`).toEqual([]);
      const errors = lines.filter(line => /^ERROR /.test(line));
      expect(lines.filter(line => line === `${errors.length} error(s)`), `${rule.name}: the count line`).toHaveLength(1);
      expect(await readFile(path, 'utf8'), `${rule.name}: ${command} writes nothing`).toBe(original);
    }
    // The server refuses the same file with the same lines (without the ERROR prefix).
    const response = await request.post(`${baseURL()}/api/files`, { headers: { 'X-Archdraw-Token': auth }, data: { path } });
    expect(response.status(), rule.name).toBe(400);
    const served = ((await response.json()).errors as string[]).join('\n');
    expect(served, rule.name).toMatch(new RegExp(rule.pattern.source.replace(/^\^ERROR /, '^'), 'm'));
    expect(await readFile(path, 'utf8'), rule.name).toBe(original);
  }

  // Several broken rules in one file: every violation is listed, and the count says how many.
  const many = valid(); many.facts.components[0].kind = 'database'; many.facts.components[1].files = ['../escape.ts'];
  many.channels.overview.views![0].nodes[0].label = 'x'.repeat(49); many.channels.linkedin!.outdated = ['db', 'db'];
  const manyPath = join(folder.dir, 'many.json'); await writeJSON(manyPath, many);
  const everything = await cli(['validate', manyPath]); expect(everything.code).toBe(1);
  const listed = everyLine(everything).filter(line => /^ERROR /.test(line));
  for (const path of ['facts.components[0].kind', 'facts.components[1].files', `${OVERVIEW}.nodes[0].label`, 'channels.linkedin.outdated']) expect(listed.some(line => line.startsWith(`ERROR ${path}`)), path).toBe(true);
  expect(listed.length).toBeGreaterThanOrEqual(4);
  expect(everyLine(everything)).toContain(`${listed.length} error(s)`);

  // A path that is only missing from the repository is a warning where a drawing is opened, an error where it is validated.
  const missing = valid(); missing.facts.components[0].files = ['src/not-written-yet.ts'];
  const missingPath = join(folder.dir, 'missing-file.json'); await writeJSON(missingPath, missing);
  const checked = await cli(['validate', missingPath]); expect(checked.code).toBe(1);
  expect(everyLine(checked).some(line => line.startsWith('ERROR facts.components[0].files'))).toBe(true);
  const reopened = await cli(['open', missingPath, '--no-browser']); expect(reopened.code, reopened.stderr).toBe(0);
  const warned = everyLine(reopened).filter(line => /^WARN /.test(line) && line.includes('does not exist in the repository'));
  expect(warned.length).toBeGreaterThanOrEqual(1); expect(warned[0]).toContain('facts.components[0].files'); expect(warned[0]).toContain('src/not-written-yet.ts');
});
