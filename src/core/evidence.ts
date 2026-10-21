/**
 * The evidence check of a read answer (docs/contracts/diagram.md, *Read answers*; ADR 0007). Pure
 * (invariant 4): the caller says which files exist and how many lines they have.
 */
import { isRepoRelative } from "./model";
import type { ComponentFact, Evidence, LimitFact, RelationFact } from "./file3";

export interface EvidenceFacts { components: ComponentFact[]; relations: RelationFact[]; limits: LimitFact[] }
export interface RepoFiles {
  /** True when the repository-relative path is a file under the repository root. */
  exists: (relPath: string) => boolean;
  /** The file's number of lines (a last line without a newline counts). */
  lineCount: (relPath: string) => number;
}

const at = (e: Evidence) => (e.lines ? `${e.file}:${e.lines[0]}-${e.lines[1]}` : e.file);

/**
 * Drop each evidence entry the repository does not support, then each fact left with none, then
 * what depended on a dropped component: a relation to it, a mechanism within it, a limit on it.
 * One warning per drop, each step over every fact before the next. A path listed twice in one fact
 * is kept once (its first supported entry), silently.
 * A component's `files` become its evidence files, each once, at most 20.
 */
export function checkEvidence(facts: EvidenceFacts, repo: RepoFiles): { facts: EvidenceFacts; warnings: string[] } {
  const warnings: string[] = [];
  const keep = (id: string, list: Evidence[] | undefined): Evidence[] => {
    const out: Evidence[] = [], missing = new Set<string>();
    for (const e of list ?? []) {
      const file = e.file.replace(/\\/g, "/").replace(/^\.\//, "");
      // A path listed twice is kept once (its first supported entry); a missing path is warned once.
      if (out.some((x) => x.file === file) || missing.has(file)) continue;
      const reason = !isRepoRelative(file) ? "outside the repository" : !repo.exists(file) ? "not found" : null;
      if (reason) missing.add(file);
      const n = reason ? 0 : repo.lineCount(file);
      const bad = reason ?? (e.lines && !(e.lines[0] >= 1 && e.lines[0] <= e.lines[1] && e.lines[1] <= n) ? `the file has ${n} lines` : null);
      if (bad) { warnings.push(`${id}: dropped the evidence ${at({ ...e, file })}: ${bad}`); continue; }
      out.push({ file, lines: e.lines ? [e.lines[0], e.lines[1]] : null });
    }
    return out;
  };
  const noneLeft = (id: string) => { warnings.push(`Dropped "${id}": no evidence left`); return false; };

  // Step 1 over every fact, then step 2, then step 3.
  const checked = {
    comps: facts.components.map((c) => ({ ...c, evidence: keep(c.id, c.evidence) })),
    rels: facts.relations.map((r) => ({ ...r, evidence: keep(r.id, r.evidence) })),
    lims: facts.limits.map((l) => ({ ...l, evidence: keep(l.id, l.evidence) })),
  };
  const comps = checked.comps.filter((c) => c.evidence.length > 0 || noneLeft(c.id));
  const rels = checked.rels.filter((r) => r.evidence.length > 0 || noneLeft(r.id));
  const lims = checked.lims.filter((l) => l.evidence.length > 0 || noneLeft(l.id));

  // What depended on a dropped component goes too: mechanisms first, so relations and limits on them follow.
  const known = new Set(comps.map((c) => c.id));
  const dropped = (id: string, on: string) => { warnings.push(`Dropped "${id}": its component "${on}" was dropped`); return false; };
  const kept = comps.filter((c) => !c.within || known.has(c.within) || dropped(c.id, c.within));
  const ids = new Set(kept.map((c) => c.id));
  const relations = rels.filter((r) => (ids.has(r.from) || dropped(r.id, r.from)) && (ids.has(r.to) || dropped(r.id, r.to)));
  const limits = lims.filter((l) => ids.has(l.on) || dropped(l.id, l.on));
  const components = kept.map((c) => ({ ...c, files: [...new Set(c.evidence.map((e) => e.file))].slice(0, 20) }));
  return { facts: { components, relations, limits }, warnings };
}
