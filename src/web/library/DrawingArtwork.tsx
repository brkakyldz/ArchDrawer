import { useId } from "react";

/** Schematic card artwork: decorative, not a preview of the actual saved diagram. */
const GRAPHS = [
  { nodes: [[53, 86], [187, 49], [187, 142], [322, 91]], edges: [[0, 1], [0, 2], [1, 3], [2, 3]] },
  { nodes: [[57, 97], [187, 97], [316, 35], [316, 154]], edges: [[0, 1], [1, 2], [1, 3]] },
  { nodes: [[59, 43], [59, 147], [189, 96], [322, 96]], edges: [[0, 2], [1, 2], [2, 3]] },
  { nodes: [[58, 97], [181, 43], [181, 155], [311, 97]], edges: [[0, 1], [0, 2], [1, 3], [2, 3]] },
] as const;
const COLORS = ["#8e85ee", "#58cbb3", "#f3b775", "#9caff5"];

export function DrawingArtwork({ variant }: { variant: number }) {
  const graph = GRAPHS[variant % GRAPHS.length];
  const id = useId().replace(/:/g, "");
  const gridId = `art-grid-${id}`;
  const glowId = `art-glow-${id}`;

  return (
    <svg className="lib-diagram-art" viewBox="0 0 480 244" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={gridId} width="19" height="19" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1" fill="currentColor" opacity=".17" />
        </pattern>
        <radialGradient id={glowId} cx="72%" cy="12%" r="85%">
          <stop offset="0" stopColor={COLORS[variant % COLORS.length]} stopOpacity=".17" />
          <stop offset="1" stopColor={COLORS[variant % COLORS.length]} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="480" height="244" fill={`url(#${gridId})`} />
      <rect width="480" height="244" fill={`url(#${glowId})`} />
      <g fill="none" stroke="currentColor" opacity=".27" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {graph.edges.map(([start, end], index) => {
          const a = graph.nodes[start], b = graph.nodes[end];
          const x1 = a[0] + 90, y1 = a[1] + 23, x2 = b[0], y2 = b[1] + 23;
          const middle = (x1 + x2) / 2;
          return <path key={index} d={`M${x1} ${y1} H${middle} V${y2} H${x2}`} />;
        })}
      </g>
      {graph.nodes.map(([x, y], index) => (
        <g key={index} className="lib-art-node">
          <rect x={x} y={y} width="90" height="46" rx="10" fill="var(--art-node-bg, #1c2333)" stroke="currentColor" strokeOpacity=".22" />
          <rect x={x + 13} y={y + 11} width="13" height="13" rx="4" fill={COLORS[(index + variant) % COLORS.length]} />
          <rect x={x + 34} y={y + 12} width="42" height="4.5" rx="2.25" fill="currentColor" opacity=".57" />
          <rect x={x + 13} y={y + 30} width="61" height="3" rx="1.5" fill="currentColor" opacity=".20" />
        </g>
      ))}
      <circle cx="438" cy="210" r="16" fill="none" stroke="currentColor" strokeOpacity=".13" />
      <path d="M432 210h12m-6-6v12" stroke="currentColor" strokeOpacity=".3" strokeLinecap="round" />
    </svg>
  );
}
