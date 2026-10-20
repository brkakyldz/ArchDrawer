import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { EngineInfo } from "../api";
import { Icon } from "../ui/Icon";
import type { Runner } from "./runner";

export interface AskHandle {
  prefill: (text: string) => void;
}

interface Props {
  runner: Runner;
  /** The engine and model a run uses (ui contract, Choosing the engine); null engine: none is available. */
  engine: EngineInfo | null;
  model: string;
  /** Open the AI panel with what is typed. */
  onExpand: (text: string) => void;
  /** A channel with no drawing: nothing to change (ui contract, Channels). */
  disabled?: boolean;
}

const SAVED = "Saved in the file for your next archdrawer session";

/**
 * The short instruction box: with an engine, the server runs Claude Code or Codex
 * headless on the repository for the current view and the drawing updates in place; without one,
 * the instruction waits in the file for the next session. The AI panel holds the longer form.
 */
export const AskBox = forwardRef<AskHandle, Props>(function AskBox({ runner, engine, model, onExpand, disabled = false }, ref) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const { state } = runner;
  const mine = state.req?.origin === "ask";

  const focusEnd = (t: string) => requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(t.length, t.length); });
  useImperativeHandle(ref, () => ({ prefill: (t: string) => { setText(t); focusEnd(t); } }));

  const placeholder = !engine ? "Ask Claude to change this drawing"
    : engine.test ? "Ask the test engine (no AI) to change this drawing" : `Ask ${engine.label} to change this drawing`;

  const send = (typed: string) => {
    const instruction = typed.trim();
    if (!instruction || state.status === "running") return;
    setText("");
    void runner.start({ instruction, engine: engine?.id ?? null, model: model || null, scope: { kind: "view" }, origin: "ask" });
  };
  const retry = () => { if (state.req) { setText(""); runner.retry(); } };
  // A failed or cancelled run puts its instruction back in the box (ui contract, ask-error).
  const shown = mine && (state.status === "failed" || state.status === "cancelled") && !text ? state.req!.instruction : text;

  return (
    <div className="ask" onPointerDown={(e) => e.stopPropagation()}>
      <form onSubmit={(e) => { e.preventDefault(); send(shown); }}>
        <span className="spark"><Icon name="spark" size={18} /></span>
        {state.status === "running" ? (
          <>
            <div className="status" data-testid="ask-status" role="status"><span className="spinner" />{state.lines[state.lines.length - 1] ?? "Starting"}</div>
            <button type="button" className="btn small" data-testid="ask-cancel" onClick={runner.cancel}>Cancel</button>
          </>
        ) : (
          <>
            <input ref={input} data-testid="ask-input" disabled={disabled} value={shown} placeholder={placeholder} aria-label={placeholder} autoComplete="off" maxLength={4000}
              onChange={(e) => { setText(e.target.value); if (mine) runner.clear(); }}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") input.current?.blur(); }} />
            <button type="button" className="btn icon-btn expand" data-testid="ask-expand" aria-label="Open the AI panel" title="More options"
              onClick={() => { const t = shown; setText(""); if (mine) runner.clear(); onExpand(t); }}>
              <Icon name="expand" size={16} />
            </button>
            <button className="btn primary send" data-testid="ask-send" aria-label="Send" type="submit" disabled={disabled}><Icon name="send" size={16} /></button>
          </>
        )}
      </form>
      {mine && state.error && state.status !== "running" && (
        <div className="note-line err" data-testid="ask-error" role="alert">
          <span>{state.error}</span>
          <button type="button" className="btn small" data-testid="ask-retry" onClick={retry}>Try again</button>
        </div>
      )}
      {mine && state.status === "saved" && <div className="note-line" data-testid="ask-saved">{SAVED}</div>}
    </div>
  );
});
