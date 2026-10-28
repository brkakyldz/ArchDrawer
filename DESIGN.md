---
name: archdrawer
description: A clean light canvas for drawing a repository's architecture, where each component carries its kind icon and a soft glow, and the export reads where it is shared.
colors:
  canvas: "#f4f5f7"
  dot: "#d3d7de"
  surface: "#ffffff"
  surface-2: "#f1f3f6"
  surface-3: "#e8ebf0"
  line: "#e2e5ea"
  line-2: "#cdd2da"
  ink: "#14161b"
  muted: "#555c69"
  soft: "#6b7280"
  brand: "#0891b2"
  accent: "#2563eb"
  accent-ink: "#ffffff"
  accent-soft: "rgba(37, 99, 235, .12)"
  note: "#fff3bf"
  note-ink: "#4a3b00"
  note-line: "#ecd77a"
  k-actor: "#64748b"
  k-client: "#0891b2"
  k-api: "#7c3aed"
  k-service: "#059669"
  k-worker: "#ea580c"
  k-llm: "#e11d48"
  k-external: "#78716c"
  k-ops: "#c026d3"
  k-gate: "#a16207"
  k-data: "#4d7c0f"
  dark-canvas: "#0d0f13"
  dark-dot: "#272b33"
  dark-surface: "#161920"
  dark-surface-2: "#1d2129"
  dark-surface-3: "#252a33"
  dark-line: "#262b34"
  dark-line-2: "#343a46"
  dark-ink: "#eceef2"
  dark-muted: "#a8afbb"
  dark-soft: "#9aa1ad"
  dark-brand: "#00d8fa"
  dark-accent: "#5b8cff"
  dark-accent-ink: "#0b0f19"
  dark-accent-soft: "rgba(91, 140, 255, .16)"
  dark-note: "#3a3420"
  dark-note-ink: "#f4e7b0"
  dark-note-line: "#5a4f2c"
  dark-k-actor: "#94a3b8"
  dark-k-client: "#22d3ee"
  dark-k-api: "#a78bfa"
  dark-k-service: "#34d399"
  dark-k-worker: "#fb923c"
  dark-k-llm: "#fb7185"
  dark-k-external: "#a8a29e"
  dark-k-ops: "#e879f9"
  dark-k-gate: "#facc15"
  dark-k-data: "#a3e635"
typography:
  dialog-title:
    fontFamily: "Geist, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  callout-title:
    fontFamily: "Geist, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  component-title:
    fontFamily: "Geist, Segoe UI, sans-serif"
    fontSize: "14.5px"
    fontWeight: 600
    letterSpacing: "-0.012em"
  compact-title:
    fontFamily: "Geist, Segoe UI, sans-serif"
    fontSize: "13.5px"
    fontWeight: 600
    letterSpacing: "-0.012em"
  home-title:
    fontFamily: "Geist, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    letterSpacing: "-0.02em"
  home-heading:
    fontFamily: "Geist, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  library-heading:
    fontFamily: "Geist, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Geist, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  explanation:
    fontFamily: "Geist, Segoe UI, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.55
  ui:
    fontFamily: "Geist, Segoe UI, sans-serif"
    fontSize: "13.5px"
    fontWeight: 500
  small:
    fontFamily: "Geist, Segoe UI, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
  edge-label:
    fontFamily: "Geist, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 500
  group-label:
    fontFamily: "Geist, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.06em"
  step-number:
    fontFamily: "Geist, Segoe UI, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
  mono-repo:
    fontFamily: "Geist Mono, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 500
  mono-path:
    fontFamily: "Geist Mono, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
  mono-meta:
    fontFamily: "Geist Mono, Consolas, monospace"
    fontSize: "11.5px"
    fontWeight: 400
  caption-title:
    fontFamily: "Geist, Segoe UI, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  caption-lede:
    fontFamily: "Geist, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  inline: "4px"
  sm: "6px"
  item: "7px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  note-tail: "14px"
  dialog: "16px"
  group: "18px"
  pill: "999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "14px"
  2xl: "18px"
  dot-grid: "22px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "34px"
  button-hover:
    backgroundColor: "{colors.surface-2}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "34px"
  button-toggled:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  tools:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "3px"
  tool-button:
    textColor: "{colors.muted}"
    rounded: "{rounded.item}"
    width: "34px"
    height: "32px"
  tool-button-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  top-bar:
    backgroundColor: "{colors.surface}"
    padding: "10px 14px"
  component-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.component-title}"
    rounded: "{rounded.xl}"
    padding: "0 12px"
    width: "196px"
    height: "108px"
  component-compact:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.compact-title}"
    rounded: "{rounded.xl}"
    padding: "0 12px"
    width: "208px"
    height: "46px"
  component-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.component-title}"
    rounded: "{rounded.xl}"
    padding: "11px 12px"
  held-item:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.small}"
    rounded: "{rounded.item}"
    padding: "0 9px"
    height: "26px"
  group:
    rounded: "{rounded.group}"
    padding: "0 14px"
  note:
    backgroundColor: "{colors.note}"
    textColor: "{colors.note-ink}"
    typography: "{typography.explanation}"
    padding: "12px 14px"
    width: "184px"
  edge-label:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    typography: "{typography.edge-label}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  step-badge:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.step-number}"
    rounded: "{rounded.pill}"
    size: "21px"
  callout:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.explanation}"
    rounded: "{rounded.xl}"
    width: "296px"
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.small}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "26px"
  ai-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    width: "368px"
  share-dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    width: "min(1180px, calc(100% - 48px))"
    height: "min(720px, calc(100% - 48px))"
  share-option:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "7px 10px"
  arrange-block:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.lg}"
    padding: "12px"
  caption:
    textColor: "{colors.ink}"
    typography: "{typography.caption-title}"
  start-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.home-title}"
    rounded: "{rounded.dialog}"
    padding: "22px 24px 24px"
  home-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.mono-path}"
    rounded: "{rounded.lg}"
    padding: "0 14px 0 40px"
    height: "46px"
  home-step:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.soft}"
    rounded: "{rounded.pill}"
    size: "22px"
  home-step-now:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
  home-tabs:
    backgroundColor: "{colors.surface-2}"
    rounded: "9px"
    padding: "2px"
  home-tab-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    height: "28px"
  home-option:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.compact-title}"
    rounded: "{rounded.xl}"
    padding: "13px 14px"
  home-destination:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "14px"
  home-draw-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "14px 16px"
  library-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.component-title}"
    rounded: "14px"
  side-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "14px"
    padding: "10px 14px 14px"
  activity-row:
    textColor: "{colors.ink}"
    typography: "{typography.compact-title}"
    rounded: "9px"
    padding: "8px"
---

# Design System: archdrawer

## Overview

**Creative North Star: "The Lit Drafting Table"**

archdrawer sits in the category standard: a clean, near-white canvas tool at the craft level of tldraw, Figma and Linear. A quiet dot grid, white components on hairline borders, one blue that means "you did this". What keeps it recognisable is one trait: every component carries its kind icon in the kind's colour, and that colour leaks out as a soft, low glow under the component and along the edges that leave it. The drawing is lit from inside; the chrome around it stays grey and still.

The density is a working tool's, not a poster's. Type runs small (11.5 to 15px in the editor) and tight, components are compact, and explanation opens beside the component on the canvas instead of in a fixed inspector. The same drawing, at the same geometry, becomes the shared image: no chrome, no product mark, a caption under or beside the drawing the way a figure carries its caption.

A dark theme carries the identical system: same structure, same tokens by role, kind hues lifted to their bright 300 to 400 steps and the edge glow raised so the drawing still reads as lit on a near-black canvas. The rejected alternatives are the dark navy SaaS canvas with neon cards and the generic right-hand inspector panel.

**Key Characteristics:**
- Near-white canvas (light) or near-black (dark) with a 22px dot grid; chrome on plain surface white.
- Kind colour appears only in a component's icon, its top tint, its under-glow, its hover border and the edges that leave it.
- One blue, reserved for selection, the numbered steps and the primary action.
- Geist for everything readable; Geist Mono for repository names, paths, sizes and counts.
- Node sizes come from content; the editor and the export draw from one geometry.
- Explanations unfold as callouts in free canvas, drawn at screen size whatever the zoom.

## Colors

A cool-grey neutral scaffold, one saturated selection blue, ten kind hues that only ever live inside the drawing, and one brand cyan that lives only in the logo.

### Primary
- **Selection Blue** (accent; dark-accent in the dark theme): the only colour that means state or action. Selected component and group borders, the 3px soft selection ring (accent-soft), the active tool, toggled buttons, focus outlines, numbered step badges, the Share and Send buttons, the selected share format and the LinkedIn version block on a LinkedIn view. Its hue (221) is deliberately kept clear of every kind hue.

### Secondary
- **Kind Hues** (k-actor slate, k-client cyan, k-api violet, k-service emerald, k-worker orange, k-llm rose, k-external stone, k-ops fuchsia, k-gate amber, k-data lime; dark-k-* are their bright siblings): one per component kind (Person, Client app, API, Service, Background job, AI agent, External, Monitoring, Check, Data store). Each paints the component's icon (with a drop-shadow glow), a radial tint at the top of the component, the under-glow, the hover border mix, the dot in a chip or colour key, and the gradient stroke of every edge, which runs from the source's hue to the target's. The AI-agent rose also marks the AI panel's spark, because the panel talks to the agent.

### Tertiary
- **Brand Cyan** (brand; dark-brand, the brighter cyan of the logo, in the dark theme): the archdrawer mark and nothing else. It never marks state or a kind, and it never appears in an export.
- **Note Butter** (note, note-ink, note-line): sticky-note yellow for user notes only, with its own dark ink and border so it never borrows a kind hue.

### Neutral
- **Canvas Grey** (canvas) with **Dot Grey** (dot): the working ground and its grid.
- **Surface White** (surface): components, callouts, the top bar, the tools, the AI panel, the share dialog.
- **Well Grey** (surface-2) and **Pressed Grey** (surface-3): held items, chips, hover fills, the share preview well and the LinkedIn version block; surface-3 is chip hover.
- **Hairline** (line) and **Firm Hairline** (line-2): line separates inside chrome (tools, edge labels, held items); line-2 is the component, callout, button and dialog border.
- **Ink** (ink): titles and body. **Muted** (muted): sub-lines, crumbs, edge labels, caption lede. **Soft** (soft): metadata, mono sizes, group labels, close icons.

### Named Rules
**The One Blue Rule.** Blue means selected, a numbered step, focus or the primary action, nothing else. No kind hue may sit near hue 221, and no decoration may borrow the accent.

**The Kind Lives in the Icon Rule.** A component's body stays surface white and its title stays ink. Its kind colour appears only in the icon, the faint top tint (12% light, 10% dark), the under-glow, the hover border and the edges that leave it.

## Typography

**Display Font:** none; the product has no display tier.
**Body Font:** Geist (with Segoe UI, sans-serif), self-hosted as a variable woff2 in `src/web/fonts/`, OFL notice beside it.
**Label/Mono Font:** Geist Mono (with Consolas, monospace), same folder.


**Character:** a neutral, engineered grotesk paired with its own mono, so names and paths read as one family. Titles tighten slightly (-0.01 to -0.02em); nothing is set light or decorative.

### Hierarchy
- **Dialog title** (600, 18px): the share dialog's heading.
- **Home title** (600, 20px, -0.02em): `Draw a project`. **Library heading** (600, 17px): `Drawings`. **Home heading** (600, 15px): `What should it draw?` and `Where will it go?`.
- **Callout title** (600, 15px): the component name at the top of its explanation.
- **Component title** (600, 14.5px; 13.5px in a compact): every component and group name on the canvas.
- **Body** (400, 14px, 1.45): base text and the AI panel's input.
- **Explanation** (400, 13.5px, 1.55): callout prose and notes.
- **UI** (500, 13.5px): buttons, crumbs, toggles, share options.
- **Small** (400, 12.5px): sub-lines, held items, chips, the LinkedIn version hint.
- **Edge label** (500, 12px): connection labels.
- **Group label** (600, 11.5 to 12px, uppercase, 0.06em): heads a group of facts or controls inside a callout or the share panel ("Connected to", "In the code", "Where", "Theme", "Show").
- **Mono** (Geist Mono): repository name 500 13px; paths 12px; sizes, counts, shortcut keys and zoom percent 11 to 12px.
- **Caption** (600, letter-spacing -0.02em, line-height 1.2): the export's title, sized per format in image pixels: 28 LinkedIn post, 32 README, 38 slide, 30 square, 36 LinkedIn feed. The lede runs 18 / 20 / 24 / 19 / 22px at 400, and the colour key 17 / 18 / 21 / 18 / 21px.

### Named Rules
**The Mono Means Machine Rule.** Geist Mono is for things the machine names: repository, paths, pixel sizes, counts, keys, percentages. Never for prose or component names.

**The Group Label Is Not an Eyebrow Rule.** The uppercase tracked label heads a block of controls or facts; it never sits above a headline as a kicker.

## Layout

The editor is a two-row grid: a top bar (logo, repository name in mono, view breadcrumb and a saved dot left; tools centred; theme, Steps and Share right), then a canvas that fills the rest. Overlays float on the canvas: zoom controls bottom left (14px inset), toasts top centre, and an AI result's Accept and Undo bar over the stage. Side panels (the AI panel, a pinned callout, the LinkedIn and steps panels) take a 368px column of their own, so the canvas narrows and nothing is covered.

The canvas is infinite and transformed as a single world (translate plus scale). Fitting leaves 34px top, 56px sides and 96px bottom, and caps zoom at 115%. The drawing is two-dimensional: a main path with side paths above and below it, and groups that hold their own components.

Spacing is a tight 4 / 6 / 8 / 12 / 14 / 18px ladder; gaps between chrome items are 2 to 10px. The export sits its drawing inside per-format margins (40 LinkedIn and square, 56 README, 64 slide, 52 LinkedIn feed).

Below 760px the bar drops the repo name, breadcrumb, saved dot, undo/redo and tooltips, buttons lose their text labels, the zoom moves to the top left and a side panel stacks under the canvas.

### Named Rules
**The Content Sizes the Node Rule.** A component's size is a function of its content, never of CSS. A card is 196 by 108, a compact 208 by 46, a panel's height is 24 + 22 for the header, + 17 with a sub-line, + 10 + 26 per held item + 4 between items. The editor and the SVG/PNG export draw from these same numbers through one geometry; when held items are hidden in the export, a panel shrinks around its own centre.

**The Screen-Size Callout Rule.** A callout is drawn at screen size (scaled by 1 / zoom) and keeps its offset from its component in screen pixels, so zooming never blows it up or detaches it. It is placed in free canvas: right first, then left, below, above, scored so it never covers its own component, its connected neighbours, its group or its members, or another open callout; it prefers staying on screen, and the canvas pans just enough to reveal it.

**The Label Never Covers Rule.** An edge label sits on its line, or beside it when the line is busy. When there is no free spot it is left out of the drawing; it is never drawn over a component.

## Elevation & Depth

A hybrid. The chrome is nearly flat: hairline borders and a two-layer ambient shadow. Components add a coloured under-glow in their kind hue, which is the system's signature depth cue; it is depth by light rather than by lift. State raises it (hover strengthens the glow, dragging lifts the component 2px and scales it 1.01 with a darker shadow). Floating overlays (callout, preview bar, toast, dialog) take progressively deeper, softer neutral shadows. The dark theme uses deeper neutral shadows and raises the edge glow from 0.12 to 0.18 opacity.

### Shadow Vocabulary
- **Ambient** (`0 1px 2px rgba(16,24,40,.06), 0 6px 16px -10px rgba(16,24,40,.18)`; dark `0 1px 2px rgba(0,0,0,.4), 0 10px 24px -14px rgba(0,0,0,.7)`): components, zoom, the preview bar.
- **Kind glow** (`0 10px 28px -12px color-mix(in srgb, kind 62%, transparent)`, 80% on hover and selection; dark 58% / 78%): under every card, compact and panel. Groups use `0 16px 44px -24px` at the same mix.
- **Icon glow** (`drop-shadow(0 0 7px color-mix(in srgb, kind 65%, transparent))`): on the kind icon.
- **Selection ring** (`0 0 0 3px accent-soft`): selected component, group, note, option, focused AI input.
- **Callout** (`0 2px 4px rgba(16,24,40,.06), 0 24px 48px -24px rgba(16,24,40,.45)`).
- **Lift** (`0 2px 4px rgba(16,24,40,.06), 0 22px 40px -22px rgba(16,24,40,.38)`; dark `0 2px 4px rgba(0,0,0,.45), 0 26px 50px -24px rgba(0,0,0,.9)`): a home card under the pointer, the folder list, the notice.
- **Dialog** (`0 40px 90px -30px rgba(0,0,0,.55)`) over a 45% near-black backdrop with a 3px blur.

### Named Rules
**The Glow Is Low Rule.** The glow sits under and below the component (negative spread, offset down), never as a halo around it, and never replaces the hairline border.

## Shapes

Gently rounded rectangles throughout, radius rising with size: 6px for edge labels and tooltips, 7px for held items and tool buttons, 8px for buttons and options, 10px for the tool group, zoom, LinkedIn version block and toast, 12px for components, callouts and the preview bar, 16px for the dialog, 18px for groups, full pills for chips and step badges. Notes are the one asymmetric shape: 4px corners with a 14px bottom-left tail. Icons are 24-unit line icons at 1.75 stroke (1.6 at 26px on cards), round caps and joins. Callouts carry a 10px rotated-square pointer on the side facing their component.

## Components

### Buttons
- **Shape:** gently rounded (8px), 34px tall, 13px side padding, 16px icon with a 7px gap.
- **Default:** surface fill, firm hairline border, ink text, UI type; hover fills with well grey.
- **Primary:** selection blue fill and border, accent-ink text at 600; hover brightens 6%. Used once per context: Share, Send, Download PNG, Open inside.
- **Toggled:** accent-soft fill, accent text and a 55% accent border (Steps when on).
- **Icon only:** 34 by 34 (theme switch).

### Tools
A segmented strip in a 10px-rounded surface box with a hairline border and 3px padding; 34 by 32 icon buttons, 1px separators between groups (select and pan / component, connect, note / undo and redo). Active tool takes accent-soft fill and accent icon; disabled icons fall to the firm hairline grey. Tooltips appear after 350ms below the button in an ink chip with the shortcut in mono.

### Top bar
Surface white with a hairline bottom border, three-column grid. Left: the logo (the 22px brand-cyan mark and the lower-case wordmark `archdrawer` in 500 ink; below 900px the mark alone), which leads back to all drawings, a hairline divider, the repository name in mono, a slash-separated breadcrumb of views (current view in 600 ink), and a 7px saved dot. Centre: tools. Right: theme, Steps, Share. Below 560px the tools take a second row under the other two groups. The home screen's bar is sticky and 56px tall on a translucent surface (86%, blurred): the logo, the divider and `Drawings` in muted 500; on the right the engine chip (a pill: a 7px emerald dot with a soft ring, `Engine` in muted, the engine in ink), the 34px theme switch and Import.

### Components on the canvas
- **Card** (196 by 108): the kind icon in a 30px rounded square of 12% of its hue, centred, then title and sub-line; no rule on the edge. The shape a newly added component takes. A part with an inside wears the open mark top right: a 20px circle tinted and ringed in its hue, never a solid disc.
- **Compact** (208 by 46): icon, title and an optional mono sub-line in one row. Used for components inside a group.
- **Panel**: icon and title row with an optional sub-line, then the component's held items as 26px rounded well-grey rows with a hairline border, 4px apart. The panel is how a component shows what it holds.
- **Group**: a component holding components. 18px corners, a border mixing 38% of its kind into the firm hairline, a 5% kind wash over a 60% translucent surface, a 46px header with icon, title and muted sub-line; its members are compacts inside it.
- All of them: 1px firm hairline border, 12px corners, ambient shadow plus kind glow, kind tint at the top. Hover mixes 45% kind into the border; selection turns the border blue with the soft ring and dims everything not connected to 40%. A stack icon top-right marks a component with a view inside. Four connection ports (11px, blue ring) appear on hover.

### Edges
Cubic curves leaving the side that faces the other end; several connections on one side spread up to 16px apart, ordered by where the other end is, so lines never stack. The stroke is a gradient from the source's kind hue to the target's, 1.75px, over a 7px glow at low opacity. A small open ring in the source hue marks where a one-way edge starts; a filled arrowhead in the target hue marks where it lands.
- **Main:** solid. In Steps mode its flow dots animate and a numbered badge rides it.
- **Async** (emit): dashed 6 / 5.
- **Dep:** dotted 1.5 / 4.5 at 1.6px, no glow.
- **Two-way:** arrowheads at both ends, no start ring.
- **Selected:** 2.6px line, 0.3 glow. Dimmed: 16% opacity.

### Edge label and step badge
- **Edge label:** surface pill with a hairline border, 6px corners, 2 / 8px padding, muted 12px 500 text, centred on its line (see The Label Never Covers Rule).
- **Step badge:** a 21px blue disc with the step number in accent-ink 600, ringed 3px in canvas colour with a soft blue glow; shown only in Steps mode. Steps mode dims edges off the main path.

### Note
184px wide, at least 84px tall, note butter fill, note-line border, note ink at 13.5 / 1.45, 4px corners with a 14px bottom-left tail and a small neutral drop. Selected: blue border and ring. Notes are left out of the export unless turned on.

### Callout
The explanation unfolds beside its component (see The Screen-Size Callout Rule). 296px wide, surface white, firm hairline, 12px corners, callout shadow, 220ms unfold from 96%. Header: kind icon, 15px title, "Kind · sub-line" in muted 12px, a close button. Body: explanation prose, then "Connected to" as chips (kind dot with glow, name, direction arrow: goes to, comes from, both ways) that jump to the other component, then "In the code" as mono paths. Footer, above a hairline: Open inside (primary, when the component has a view inside) and Ask about it.

### Chip
26px pill, well-grey fill, hairline border, 12.5px ink text with a 7px kind dot; hover darkens to pressed grey. Also used for the AI panel's suggestions, one row per channel.

### AI panel
The one place to type an instruction (ADR 0008). A 368px column beside the stage, surface white with a hairline left border, opened by the AI button and closed by its own close button or Escape; the canvas stays usable. A rose spark (AI-agent hue) leads its header. Under it the conversation: one turn per run on the open drawing, oldest first, each a hairline card with the instruction (or the control's name) in body text and "Channel · scope" in soft 11.5px. Only the latest turn holds the live parts: the mono progress lines with Cancel, the error with Try again, the summary on accent-soft, the route sentence and the layout report; an earlier turn keeps one muted result line. Then the suggestion chips, the input ("Ask Claude to change this drawing"; Enter sends, Shift+Enter breaks the line), the scope, the engine and model, the engine note, and a footer with Look at the drawing again and a primary Send.

### Preview bar
A run's result arrives as a preview: a 12px-rounded surface bar with a blue-tinted hairline floats bottom centre over the stage with "The drawing was updated: …", the route sentence after a refine, and Accept (primary) and Undo. The parts the run added, changed or moved keep their changed glow until the user chooses.

### Share dialog
A 16px-rounded modal (up to 1180 by 720) split into a preview well (surface-2) and a 300px side column. The preview shows the actual export frame scaled to fit, with its pixel size in mono bottom left. The side column, under "Share image / Laid out for where it will be seen.", stacks: **Where** (five options with their pixel sizes in mono: LinkedIn post 1200x900, LinkedIn feed 1080x1350, README 1600x900, Slide 1920x1080, Square post 1080x1080), the **LinkedIn version** block, **Theme** (Light / Dark), **Show** (title, description, what each part holds, numbered main path, connection labels, colour key, notes), and a readability meter. Actions sit on a hairline footer: Download PNG (primary, full width), Download SVG and Copy image. Selected options take the blue border and soft ring.

**Built:** Download PNG, Download SVG and Copy image produce the real image; the AI panel runs the instruction through a headless Claude Code or Codex when one is available and otherwise saves it in the file's `requests` for the next session.

**Readability meter.** Reads the smallest text actually in the image (a held item at 12.5px, else a component name at 13.5px) at the size it is seen where it lands and at full size, and says the result in one plain sentence for the destination ("The text will be too small to read in the LinkedIn feed, even when the image is opened"), with a level dot; the pixel sizes sit behind a small Details toggle.

### Home screen
The home screen (ui contract, *Home*) is the same system as the editor: the same tokens by role in both themes, Geist and Geist Mono only, one blue. It adds no colour. Its light is a little bolder: the start panel's head carries the dot grid and a low accent light, and cards lift under the pointer.

- **Columns.** A 236px navigation column on surface white with a hairline right border: Drawings with its count in mono, New drawing, then *Recent* and *Found on this computer* under group labels, each entry a 34px row with an 8px kind-hue swatch (chosen by position) and the name in 12.5px mono, and the server's address in soft mono at the foot above a hairline. The work column, padded 28 / 32px, holds a centred 940px stack, 36px apart: the start panel, then the drawings. A 312px side column on a 55% mix of surface into canvas, hairline left border, stacks side panels 14px apart. At 1240px wide or less the side column moves under the work column as a grid of panels; at 860px or less the navigation becomes one row; at 640px or less everything is one column.
- **Start panel.** Surface white, firm hairline, 16px corners, ambient shadow. Behind its head, a dot grid (the dot token, 18px spacing) masked from full to nothing over 220px, and a 520 by 260px radial accent light at the top right (18% of the accent, scaled by the halo: 0.55 light, 1 dark). Head: the home title left, the stepper right.
- **Stepper.** Four 22px numbered discs joined by 18px hairlines. Now: accent fill, accent-ink number, a 4px accent-soft ring, the name in ink. Done: well-grey disc, ink number, muted name, and the hairline after it turns accent. Later: surface disc, soft number and name.
- **Source tabs.** A segmented control: a well-grey track with a hairline border, 9px corners and 2px padding; 28px tabs with a 15px icon and 12.5px 500 text; the selected tab on surface white with a firm-hairline ring.
- **Folder field.** 46px, 10px corners, firm hairline, a folder (or link) icon 13px in, text in 14px Geist Mono; focus turns the border accent with a 4px accent-soft ring; disabled sits on well grey. Beside it `Choose folder…` (a default button) and Scan (primary), both 46px with 10px corners. The folder list drops 6px under the field: 12px corners, firm hairline, the lift shadow, group labels over 36px rows (swatch, name in 500, path and age in soft mono at the right). The link hint and the error sit 8px under the field in 12.5px, the error in the AI-agent rose.
- **Scanning.** A well-grey 12px box: an 18px turning ring (accent top), `Scanning` in 600 over the latest line in muted 12px mono, a 3px track with an accent gradient sliding through it every 1.3s, and Cancel.
- **Choice cards.** Two columns, 10px apart; the whole system and Something else span both. Each: surface white, hairline, 12px corners, 13 / 14px padding; a 34px icon box in 9px corners filled with 12% of its hue, its icon glowing; the title in 600 13.5px; the sentence in muted 12.5px; file chips in 11px mono on well grey with 5px corners. Hues: the whole system the accent (layers icon), sections the kind hues in turn (client, service, AI agent, data store, API, monitoring), flows the background-job orange (flow icon), Something else muted (pen icon). Hover: firm hairline, up 1px, ambient shadow. Ticked: a 60% accent border, a 5% accent wash, the 3px selection ring, and an 18px accent tick box.
- **Destination cards.** Three in a row: a 74px well-grey frame with a 10px dot grid holding a small page in the channel's shape (LinkedIn post 4:5, README wide, Presentation 16:9) with two hairline text bars; under it the name in 600 13.5px and its size in soft 11.5px mono; a round radio at the right. Chosen: the 60% accent border and ring, the small page's border turning accent with a soft accent shadow.
- **The bar.** Above a hairline: the summary in muted 13px with the count in ink 600, Change folder (ghost), and the draw button (primary, 42px, 10px corners, 14px text, an arrow that moves 2px on hover).
- **Draw rows.** One per choice, surface white, hairline, 12px corners: the title in 600 13.5px (a 170px column), three stage marks, and the time in 12px mono at the right; under them the live line in 12px mono. A stage mark is its name in 12px over a 4px bar: waiting soft on the hairline; running accent 600 over accent-soft with a 40% accent bar sliding every 1.1s; done muted over emerald (the service hue). A long name wraps to two lines rather than being cut. The live line starts with a 7px accent dot that sends out one ring (0.9s) on every event; quiet turns the dot and the line amber (the check hue); waiting shows a hollow soft ring; done writes in emerald. Ready is an emerald box (45% emerald border, 7% wash) with Open as the primary. The draw line under the rows is muted 12px mono with a 14px turning ring.
- **Drawing cards.** A grid of 272px-minimum columns, 16px apart. Surface white, firm hairline, 14px corners, ambient shadow; hover lifts 2px with the lift shadow and the preview zooms 4%. The preview is 16:10 on canvas with a 14px dot grid, the drawing inset 10px; a `<n> views` pill top left (translucent surface, blurred), view dots bottom left (the current one a 16px accent bar), and an accent `Open` pill top right on hover. Under it the title (600 14.5px), the path in muted 12px mono, then 10px kind dots overlapping by 3px with a surface ring, and the relative time in soft 11.5px mono at the right. The list layout puts a 132px preview at the left of a row. The search field is 32 by 220px with 8px corners; the grid and list switch is a two-icon segmented control.
- **Side panels.** Surface white, firm hairline, 14px corners, ambient shadow; the header is a group label with an action at its right. Activity rows: 8px padding, 9px corners, a status dot (accent running, a hollow soft ring waiting, amber quiet, emerald done), the name in 600 13px, the status in muted 12px (amber when quiet), the time in muted 11.5px mono or a small primary Open at the right; the followed row on accent-soft. The Engine panel's two selects are 34px with 8px corners, and its status line carries the emerald dot.
- **Notice.** Top centre under the bar: surface white, firm hairline, 10px corners, the lift shadow, an emerald dot, the sentence and a small primary Open; it fades in over 0.2s.

**The Every Text Names Something Rule.** The home screen carries no hero, slogan, kicker, process guide, step counter or footer line: every text names a thing or a state.

### Figure-style caption (export)
The exported image is the drawing on canvas colour with no chrome and no product mark. Its caption belongs to it like a figure's: the title (and optional lede) plus a colour key of the kinds present, each a glowing kind dot and label. Caption and key try an empty corner of the drawing first, together as one block, then in two corners, at 36 / 31 / 26% widths; when no corner is free they share a full-width strip under the drawing above a firm hairline, title left, key right, and the drawing refits above it.

### LinkedIn version
A view of its own, made from the current one, for a tall 1080 by 1350 (4:5) post a stranger can follow. Groups fold into one card each and every part keeps its sub-line, so each one says what it does; the numbered main path is numbered again and snakes across a three- or two-column grid, and every other part sits beside what it talks to. The feed image puts the title and description across the top and, under the drawing above a hairline, the numbered steps written out: a blue badge with the number, the two parts in ink 600, and the connection's label in muted after a dash. The block in the share panel (well grey, 10px corners) offers "Make a LinkedIn version" or "Open the LinkedIn version"; on the LinkedIn view itself it turns blue-ringed and offers "Rewrite it in plain words" (primary) and "Re-arrange".

## Do's and Don'ts

### Do:
- **Do** keep blue for selection, steps, focus and the one primary action per context (The One Blue Rule).
- **Do** give every component its kind icon in its kind hue with the low under-glow; keep the body surface white and the title ink.
- **Do** compute node sizes from content and draw the editor and the export from the same geometry.
- **Do** open explanations as callouts beside their component, at screen size, in free canvas.
- **Do** set repository names, paths, sizes, counts and keys in Geist Mono, everything else in Geist.
- **Do** size the export's caption, lede and key per format in image pixels and check them with the readability meter.
- **Do** carry the dark theme as the same system: same roles, brighter kind hues, a stronger edge glow.
- **Do** keep the home screen in the editor's tokens and type; its boldness is light and lift, never a new colour or a display face.

### Don't:
- **Don't** put the product name, mark or a "made with" line on an exported image; the top-bar mark is editor chrome only.
- **Don't** fill a component with its kind colour or make cards neon on a navy canvas.
- **Don't** add a docked right-hand inspector; explanation lives on the canvas.
- **Don't** draw an edge label over a component; leave it out instead.
- **Don't** set soft text on the well grey or the canvas (4.35:1 and 4.43:1, under 4.5); keep it on surface white.
- **Don't** use the uppercase group label as an eyebrow over a headline.
