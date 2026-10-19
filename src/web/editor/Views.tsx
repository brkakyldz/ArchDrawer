import { useEffect, useRef, useState } from "react";
import { isLinkedInView, type DiagramDocument } from "../../core/model";
import { Icon } from "../ui/Icon";

/** `views-button` and `views-menu` (ui contract): every view of the drawing in file order. */
export function ViewsMenu({ doc, current, goView }: { doc: DiagramDocument; current: string; goView: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("pointerdown", close); };
  }, [open]);
  const kind = (id: string) => (id === doc.views[0].id ? "Overview" : isLinkedInView(id) ? "LinkedIn" : "Detail");
  return (
    <div className="views" ref={box}>
      <button className="btn icon-btn" data-testid="views-button" aria-label="All views" aria-haspopup="menu" aria-expanded={open} title="All views" onClick={() => setOpen(!open)}>
        <Icon name="layers" size={16} />
      </button>
      {open && (
        <div className="menu views-menu" role="menu" data-testid="views-menu">
          {doc.views.map((v) => (
            <button key={v.id} role="menuitem" data-testid={`view-item-${v.id}`} data-kind={kind(v.id)} aria-current={v.id === current ? "true" : undefined}
              onClick={() => { setOpen(false); goView(v.id); }}>
              {v.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
