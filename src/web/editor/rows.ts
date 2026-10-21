import { FACT3_LIMITS } from "../../core/file3";
import { LIMITS, type DiagramNode } from "../../core/model";

/**
 * A panel's rows (diagram contract, What a channel draws): its held mechanisms first, its own items,
 * its limits last. Each kind keeps its own fact's cap: a mechanism's label, an item, a limit's text.
 */
export type RowKind = "held" | "item" | "limit";

export function rowOf(node: Pick<DiagramNode, "items" | "heldIds" | "limitIds">, i: number): RowKind {
  const heldN = node.heldIds?.length ?? 0, firstLimit = node.items.length - (node.limitIds?.length ?? 0);
  return i < heldN ? "held" : i >= firstLimit ? "limit" : "item";
}

export const ROW_CAPS: Record<RowKind, number> = { held: LIMITS.label, item: LIMITS.item, limit: FACT3_LIMITS.limitText };
