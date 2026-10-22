import type { ReactNode } from "react";
import type { Document3, Step } from "../../core/file3";
import type { DiagramView } from "../../core/model";
import { NO_NOTE, noteLines } from "./slides";
import { tourFiles, tourParts } from "./tour";

/**
 * `tour-panel` (ui contract, Presenting and the tour): the step's note and, for each lit part, the
 * files its facts name with the lines their evidence cites. A button copies a path; nothing opens,
 * reads or checks a file.
 */
export function TourPanel({ stored, view, step, index, count, toast, exit }: {
  stored: Document3; view: DiagramView; step: Step; index: number; count: number; toast: (m: string) => void; exit: ReactNode;
}) {
  const note = noteLines(step.note);
  const copy = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      toast("Copied the path");
    } catch {
      toast("Copying is not allowed here");
    }
  };
  return (
    <aside className="tour-panel" data-testid="tour-panel" aria-label="Where this step lives in the code">
      <header>
        <span className="count">Step {index} of {count}</span>
        {exit}
      </header>
      <div className="tour-note" data-testid="tour-note">
        {note ? note.map((l, i) => <span key={i}>{i > 0 && <br />}{l}</span>) : <span className="none">{NO_NOTE}</span>}
      </div>
      <ul className="tour-parts">
        {tourParts(view, step).map((n) => {
          const files = tourFiles(stored, n.id);
          return (
            <li key={n.id} className="tour-part" data-testid="tour-part" data-node-id={n.id}>
              <h3>{n.label}</h3>
              {files.length === 0 ? (
                <p className="none">No files recorded</p>
              ) : (
                <ul>
                  {files.map((f) => (
                    <li key={f.path}>
                      <code data-testid="tour-file">{f.text}</code>
                      <button className="tour-copy" data-testid="tour-copy" aria-label={`Copy path ${f.path}`} title="Copy path" onClick={() => void copy(f.path)}>
                        Copy path
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
