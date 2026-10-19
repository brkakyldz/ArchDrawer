import { layoutDocument } from "./layout";
import { assignEdgeIds, fillDefaults, type DiagramDocument, type DiagramFile, type DiagramSource } from "./model";

/**
 * Normalisation of a valid file (diagram contract): document defaults, edge ids, positions
 * for every component that has none, group positions from their boxes. Never call it on an
 * invalid file. Returns a new document; the input is not changed.
 */
export function normalizeFile(file: DiagramFile, ctx: { id: string; now: string; source?: DiagramSource | null }): DiagramDocument {
  const filled = fillDefaults(file, { id: file.id ?? ctx.id, now: ctx.now, source: ctx.source });
  assignEdgeIds(filled);
  return layoutDocument(filled) as unknown as DiagramDocument;
}
