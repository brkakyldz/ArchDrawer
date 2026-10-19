import type { DiagramView } from "../model";

const label = (s: string) => s.replace(/"/g, "#quot;");

/** Mermaid `flowchart` text of a view, for pasting into a README: groups as subgraphs, labels kept. */
export function renderMermaid(view: DiagramView): string {
  const lines = ["flowchart LR"];
  const kids = (parent: string | null) => view.nodes.filter((n) => (n.parent ?? null) === parent);
  const walk = (parent: string | null, indent: string) => {
    for (const n of kids(parent)) {
      if (n.form === "group") {
        lines.push(`${indent}subgraph ${n.id}["${label(n.label)}"]`);
        walk(n.id, indent + "  ");
        lines.push(`${indent}end`);
      } else lines.push(`${indent}${n.id}["${label(n.label)}"]`);
    }
  };
  walk(null, "  ");
  for (const e of view.edges) {
    const arrow = e.both ? (e.style === "call" ? "<-->" : "<-.->") : e.style === "call" ? "-->" : "-.->";
    lines.push(`  ${e.from} ${arrow}${e.label ? `|${label(e.label)}|` : ""} ${e.to}`);
  }
  return lines.join("\n") + "\n";
}
