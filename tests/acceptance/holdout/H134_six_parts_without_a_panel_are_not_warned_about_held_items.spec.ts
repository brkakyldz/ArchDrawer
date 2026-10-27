import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { component, drawing, fromLegacy, withReadme, part, workspaceRaw, cli, register, getDocument, outputLines, errorLines, warnLines, type Doc3 } from './helpers';

// Six top-level parts on one row, joined by five unnumbered connections that all say `process`: the warnings the depth rules
// give are Flat, No main path and Repeated label. The README is the overview's view again; the LinkedIn view is the same six
// facts on a spine, numbered and unlabelled. Optionally the first part is a panel.
function six(title: string, withPanel: boolean): Doc3 {
  const old = drawing(title);
  old.views[0].nodes = Array.from({ length: 6 }, (_, i) => component(`part-${i}`, { place: { row: 0, col: i }, ...(withPanel && i === 0 ? { form: 'panel', items: ['Validate'] } : {}) }));
  old.views[0].edges = Array.from({ length: 5 }, (_, i) => ({ id: `flow-${i}`, from: `part-${i}`, to: `part-${i + 1}`, label: 'process', style: 'call', both: false, step: null }));
  const doc = withReadme(fromLegacy(old));
  doc.channels.linkedin = { showSteps: false, outdated: [], views: [{ id: 'linkedin', title: 'LinkedIn', caption: { title: 'Six steps', lede: 'One after the other.' },
    nodes: Array.from({ length: 6 }, (_, i) => part(`li-${i}`, { facts: [`part-${i}`], lane: { spine: i } })),
    edges: Array.from({ length: 5 }, (_, i) => ({ id: `li-e${i}`, from: `li-${i}`, to: `li-${i + 1}`, relations: [], step: i + 1 })), texts: [] }] };
  return doc;
}
const WHERE = (channel: string) => `channels.${channel}.views[0]`;

// LOOK-3: held items are used only where a story needs them, so a drawing of six or more parts is not asked for a panel any
// more. The other depth warnings are unchanged (START-5): Flat and the rest are checked on every channel view and Flat skips LinkedIn.
test('H134 [LOOK-3, START-5, FILE-1] a drawing of six parts with no panel is not warned about held items in any channel, while the flat, main path and repeated label warnings still show where their rules say', async ({ request }) => {
  const plain = await workspaceRaw('held-none', six('No panel', false)), paneled = await workspaceRaw('held-panel', six('One panel', true));
  const bytes = await readFile(plain.file, 'utf8');

  const checked = await cli(['validate', plain.file]);
  expect(checked.code, checked.stdout + checked.stderr).toBe(0); expect(errorLines(checked)).toEqual([]);
  expect(checked.stdout).toMatch(/valid with \d+ warning/);
  const lines = warnLines(checked);
  // Flat, No main path and Repeated label, on the overview view and on the README view, each at its own path.
  for (const channel of ['overview', 'readme']) {
    const own = lines.filter(line => line.includes(WHERE(channel)));
    for (const rule of [/flat|pipeline/i, /main path|step/i, /repeat/i]) expect(own.some(line => rule.test(line)), `${channel}: ${rule}`).toBe(true);
  }
  // LinkedIn: Flat is skipped there, the path is numbered and nothing is labelled, so the view has nothing to be warned about.
  expect(lines.filter(line => line.includes('channels.linkedin')), 'the LinkedIn view').toEqual([]);
  // Must not happen: a warning that asks for held items, or any warning but the three depth rules.
  expect(lines.filter(line => /held items|no panel/i.test(line)), 'no held items warning').toEqual([]);
  for (const line of lines) expect(line, 'only the three depth warnings remain').toMatch(/flat|pipeline|main path|step|repeat/i);
  // Each warning is printed as `WARN  <json path>: <message>`, with two spaces (cli contract, validate; moved from H16).
  for (const line of lines) expect(line, 'two spaces after WARN, then the path').toMatch(/^WARN  \S/);
  expect(await readFile(plain.file, 'utf8'), 'validate writes nothing').toBe(bytes);

  // The same six parts with a panel give exactly the same warnings: a panel is no longer what the drawing is measured by.
  const withPanel = await cli(['validate', paneled.file]);
  expect(withPanel.code, withPanel.stdout + withPanel.stderr).toBe(0); expect(warnLines(withPanel)).toEqual(lines);

  // Opening the drawing prints no such warning either, and the stored document carries none.
  const opened = await cli(['open', plain.file, '--no-browser']);
  expect(opened.code, opened.stdout + opened.stderr).toBe(0);
  expect(outputLines(opened).filter(line => /held items|no panel/i.test(line))).toEqual([]);
  const registered = await register(request, plain.file), stored = await getDocument(request, registered.id);
  expect((stored.warnings ?? []).filter(line => /held items|no panel/i.test(line))).toEqual([]);
  expect(stored.channels.overview.views![0].nodes.map(n => n.form)).toEqual(Array(6).fill('card')); // nothing turned a part into a panel
});
