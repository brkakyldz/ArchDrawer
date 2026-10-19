import type { IconName, Kind, Theme } from "./model";

/** Colour tokens of DESIGN.md, shared by the editor canvas and every export. */
export interface Palette {
  canvas: string; dot: string; surface: string; surface2: string; surface3: string;
  line: string; line2: string; ink: string; muted: string; soft: string;
  accent: string; accentInk: string; accentSoft: string;
  note: string; noteInk: string; noteLine: string;
  /** Opacity of the kind glow under a component, and on hover/selection. */
  glow: number; glowHover: number;
  /** Opacity of the soft glow line under every edge. */
  edgeGlow: number;
  /** Opacity of the kind tint at the top of a component. */
  tint: number;
  shadow: string;
  kinds: Record<Kind, string>;
}

export const PALETTES: Record<Theme, Palette> = {
  light: {
    canvas: "#f4f5f7", dot: "#d3d7de", surface: "#ffffff", surface2: "#f1f3f6", surface3: "#e8ebf0",
    line: "#e2e5ea", line2: "#cdd2da", ink: "#14161b", muted: "#555c69", soft: "#6b7280",
    accent: "#2563eb", accentInk: "#ffffff", accentSoft: "rgba(37,99,235,0.12)",
    note: "#fff3bf", noteInk: "#4a3b00", noteLine: "#ecd77a",
    glow: 0.62, glowHover: 0.8, edgeGlow: 0.12, tint: 0.12, shadow: "#101828",
    kinds: {
      actor: "#64748b", client: "#0891b2", api: "#7c3aed", service: "#059669", worker: "#ea580c",
      llm: "#e11d48", external: "#78716c", ops: "#c026d3", gate: "#a16207", data: "#4d7c0f",
    },
  },
  dark: {
    canvas: "#0d0f13", dot: "#272b33", surface: "#161920", surface2: "#1d2129", surface3: "#252a33",
    line: "#262b34", line2: "#343a46", ink: "#eceef2", muted: "#a8afbb", soft: "#9aa1ad",
    accent: "#5b8cff", accentInk: "#0b0f19", accentSoft: "rgba(91,140,255,0.16)",
    note: "#3a3420", noteInk: "#f4e7b0", noteLine: "#5a4f2c",
    glow: 0.58, glowHover: 0.78, edgeGlow: 0.18, tint: 0.1, shadow: "#000000",
    kinds: {
      actor: "#94a3b8", client: "#22d3ee", api: "#a78bfa", service: "#34d399", worker: "#fb923c",
      llm: "#fb7185", external: "#a8a29e", ops: "#e879f9", gate: "#facc15", data: "#a3e635",
    },
  },
};

export const FONT_SANS = "Geist, 'Segoe UI', system-ui, sans-serif";
export const FONT_MONO = "'Geist Mono', Consolas, ui-monospace, monospace";

/** Line icons on a 24-unit grid, stroke 1.75, round caps and joins (DESIGN.md, Shapes). */
export const ICON_PATHS: Record<IconName | "stack" | "x" | "ar" | "al" | "lr", string> = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.6-3.8 3.7-6 7.5-6s6.9 2.2 7.5 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.3 3.1-5.2 6.5-5.2s6 1.9 6.5 5.2M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.9c1.7.7 2.8 2.4 3 5.1"/>',
  clipboard: '<rect x="5.5" y="4.5" width="13" height="16.5" rx="2"/><path d="M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h3"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  zap: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M10 2.5h4"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.3 4.6 4.6 0 0 0 7 18.5z"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  scale: '<path d="M12 4v16M8 20h8M5 7.5h14M12 4l-7 3.5M12 4l7 3.5M5 7.5 2.5 13a2.5 2.5 0 0 0 5 0zM19 7.5 16.5 13a2.5 2.5 0 0 0 5 0z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  db: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  chat: '<path d="M20.5 12a8 8 0 0 1-11.7 7.1L4 20.5l1.4-4.6A8 8 0 1 1 20.5 12z"/>',
  loop: '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11.5V10a4 4 0 0 1 4-4h13M7 21.5 3.5 18 7 14.5"/><path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
  pen: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/>',
  box: '<rect x="3.5" y="5" width="17" height="14" rx="3"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2.5v3.5M15 2.5v3.5M9 18v3.5M15 18v3.5M2.5 9h3.5M2.5 15h3.5M18 9h3.5M18 15h3.5"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.6 7l2.6 1.5M16.8 15.5l2.6 1.5M4.6 17l2.6-1.5M16.8 8.5 19.4 7"/><circle cx="12" cy="12" r="7"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 3.2 2.8 14.8 0 18M12 3c-2.8 3.2-2.8 14.8 0 18"/>',
  key: '<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 8.3-8.3M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  file: '<path d="M6 3h8l4.5 4.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4.5h4.5"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12.5 15H17"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14"/>',
  server: '<rect x="3.5" y="3.5" width="17" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="17" height="7" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
  queue: '<rect x="3" y="5" width="4.5" height="14" rx="1"/><rect x="9.75" y="5" width="4.5" height="14" rx="1"/><path d="M17 12h4M19 10l2 2-2 2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="m7.5 15 4-4.5 3 3L20 7"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  git: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7M18 11.5c0 3-3 3.5-6 4l-3.5 1.5"/>',
  plug: '<path d="M9 2.5v5M15 2.5v5M6.5 7.5h11V11a5.5 5.5 0 0 1-11 0zM12 16.5v5"/>',
  stack: '<path d="M12 3 3 7.5l9 4.5 9-4.5z"/><path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  ar: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  al: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  lr: '<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
};

/** `#rrggbb` mixed with transparency, as an rgba() string. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.round(a * 1000) / 1000})`;
}

/** Mix of two `#rrggbb` colours, `t` of the first (CSS color-mix in srgb). */
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, "0")).join("");
}
