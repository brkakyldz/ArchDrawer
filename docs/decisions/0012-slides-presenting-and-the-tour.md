---
id: 0012
title: "One slide image per step: presenting, the tour and the exports draw from it"
date: 2026-10-22
status: accepted
deciders: [brkakyldz]
supersedes: []
---

## Context

The presentation channel has ordered steps (STORY-4): each names parts of the
one presentation view and carries an on-screen text and a speaker note. The
editor lights a step's parts and dims the rest on the canvas, and arrow keys
step through them in the steps panel. Milestone 0.5 adds three things the spec
names but does not shape: a full-screen presentation (PRES-1), a guided tour
for learning a repository from the same steps (PRES-2, ADR 0001), and the
steps as PDF pages and PNG slides (PRES-3).

What exists: the share image (`renderShare`) frames a view into a format,
`slide` being 1920 × 1080, but has no dimmed state. PNG is made only in the
browser; the command line writes SVG only. No PDF or zip code and no PDF
dependency exist. Nothing reads a fact's evidence outside the read check, and
no endpoint opens or shows a source file.

## Decision

1. **One slide image.** Core draws each slide as an SVG of exactly
   1920 × 1080: an opening slide (index 0: the presentation view's caption
   over the whole view, nothing dimmed) and one slide per step (index *i*: the view
   with the step's parts at full strength and every other part, connection
   and text at 25 % opacity, a connection lit only when both its ends are
   lit; the step's text and the counter `i / n` in a band along the bottom).
   Dimming never changes a part's box. One pure function,
   `renderSlide(doc, index, options)` in `src/core/export/slide.ts`, makes it;
   the presenter, the tour and both exports show its output and nothing else.
   It takes the share toggles (items, numbered path, labels, key, texts):
   the presenter and the tour use the slide format's starting toggles, with
   the caption's title and lede always on the opening slide; the exports use
   the share dialog's.
2. **Presenting (PRES-1).** `Present` in the header of the presentation
   channel opens a full-window layer over the editor and asks the browser for
   full screen; a refusal leaves the layer in place. It starts on the opening
   slide. Arrow keys, Space and Page keys move; Home and End jump; N shows the
   speaker note; Escape, or the browser leaving full screen, closes it and
   makes the step shown current in the steps panel. The layer edits nothing;
   an outside change to the file re-renders the slide shown.
3. **The tour (PRES-2) is the same steps, read in a window.** `Tour` opens
   the same layer without full screen, starting at the first step, with a
   panel beside the slide: the step's note as body text and, for each lit
   part, the files its facts name and the line ranges their evidence cites,
   each with a button that copies the path. Nothing opens, reads or checks a
   file. No format change: the tour has no steps of its own.
4. **Exports (PRES-3) without a dependency.** The share dialog on the
   presentation channel offers `Slides as PDF` and `Slides as PNG`. The
   browser rasterises every slide at twice its size (3840 × 2160). The PDF
   is one page of 960 × 540 points (13.333 × 7.5 in, the common 16:9 slide)
   per slide, each page one JPEG at quality 0.92, written by a small writer
   in `src/core/export/pdf.ts`. The PNG slides are one zip, stored without
   compression, written by `src/core/export/zip.ts`. Speaker notes are not in
   the exports.
5. **The command line is unchanged.** PNG and JPEG need a browser; the
   command keeps writing one SVG.

The owner accepted every recommended option of issue #106 on 2026-10-22.
Three details differ from its text:

- The page is 960 × 540 points. #106 gave "1920×1080 points" and
  "13.333 × 7.5 in"; 1920 points are 26.7 in, so the stated inches win.
- `present-count` and `present-text` are not separate elements: the count
  and the text are in the slide image's band, and `present-status`, a
  hidden live region, reads them out. The tour is the layer's
  `data-mode="tour"`, not a `tour` id.
- `present` gains `data-fullscreen`, so a test can tell a refused full
  screen from a granted one.

## Verified assumptions

The spike ran outside the repository; #109's unit tests repeat its checks
on the real writers.

| Assumption | How it was checked (2026-10-22) | Result |
|---|---|---|
| A PDF of JPEG pages needs no library | A 60-line writer (`%PDF-1.4`, one `/DCTDecode` image XObject and one content stream per page, a classic `xref`) fed two 3840 × 2160 canvas JPEGs from Chromium | pypdf in strict mode reads 2 pages of 960 × 540 with one 3840-wide DCTDecode image each; pdf.js 4 reports 2 pages, one `paintImageXObject` each; Chrome's own viewer shows both pages, `1 / 2` |
| A stored zip needs no library | A 40-line writer (local headers, central directory, CRC-32, UTF-8 flag, fixed 1980-01-01 date) with two canvas PNGs | Python's `zipfile.testzip()` finds no error; both entries read back with the PNG signature |
| Size | Two simple slides | about 100 KB per JPEG page, 210 KB per PNG; a 20-step talk stays a few MB |

## Rationale

Drawing the slide once, in core, is the reason AGENTS.md invariant 5 exists
applied to a new surface: the screen and the PDF cannot disagree when they
are the same SVG, and the function is tested once, without a browser.

The tour as a mode of the same layer is what ADR 0001 decided ("the same
step-by-step mechanism"). What a learner needs beyond the presenter is where
in the code each step lives, and the facts already carry that. Copying a path
adds no input that reaches a process (invariant 1); opening a file in the
user's editor would.

A raster PDF costs selectable text, but needs no dependency, no font
subsetting and no SVG-to-PDF conversion, and the PDF shows exactly the
pixels of the PNG slides. Text in a slide was never meant to be edited
there.

## Alternatives considered

| Alternative | Why not |
|---|---|
| The presenter reuses the editor canvas full screen | A second picture of the same slide, free to drift from the exports |
| A `tour` channel with its own steps, able to point into detail views | A format change and a second set of steps to keep current, for a side job |
| The tour opens files in the user's editor | A new endpoint whose input reaches a process; the paths are enough to find the code |
| Vector PDF pages through `jsPDF` + `svg2pdf.js` or `pdf-lib` | Two dependencies and font embedding for selectable text nobody asked for |
| The browser's print dialog | Not testable, and the page size and margins are the browser's |
| One PNG download per slide | Up to 21 downloads, which browsers ask about one by one |
| Speaker notes as PDF pages | Not asked for; a later option if a presenter wants handouts |

## Consequences

- **Upside:** one picture of a slide everywhere; a tour at no format cost; no
  new dependency.
- **Cost:** PDF text is not selectable or searchable. The exports exist only
  in the browser. A slide's dimmed state is a second look the layout report
  does not measure (it measures the view, as for the share image).
- The spec's PRES rows stay `To build` until built; the ui contract gains
  *Presenting*, *Tour* and the slide rows of *Share*; the testing contract
  says how a test reads a PDF and a zip.
