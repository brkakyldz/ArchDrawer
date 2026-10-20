import { useCallback, useState } from "react";

const LIMIT = 200;
const COALESCE_MS = 900;

interface State<D> {
  past: D[];
  present: D | null;
  future: D[];
  key: string | null;
  at: number;
}

export interface ApplyOptions {
  /** false: replace the present without a history entry (live drag). Default true. */
  record?: boolean;
  /** Edits with the same key within a short window become one undo step (typing in a field). */
  coalesce?: string;
}

/** Document state with undo/redo: at least 100 steps, typing in one field coalesced until it loses focus, drags one step each. */
export function useDocHistory<D>() {
  const [s, setS] = useState<State<D>>({ past: [], present: null, future: [], key: null, at: 0 });

  const reset = useCallback((doc: D) => setS({ past: [], present: doc, future: [], key: null, at: 0 }), []);

  const apply = useCallback((next: D | ((d: D) => D), opts: ApplyOptions = {}) => {
    setS((st) => {
      if (!st.present) return st;
      const doc = typeof next === "function" ? (next as (d: D) => D)(st.present) : next;
      if (doc === st.present) return st;
      if (opts.record === false) return { ...st, present: doc };
      const now = Date.now();
      if (opts.coalesce && opts.coalesce === st.key && now - st.at < COALESCE_MS) {
        return { ...st, present: doc, future: [], at: now };
      }
      return { past: [...st.past, st.present].slice(-LIMIT), present: doc, future: [], key: opts.coalesce ?? null, at: now };
    });
  }, []);

  /** End the current coalesced step: the next edit starts a new undo step (a field lost focus). */
  const seal = useCallback(() => setS((st) => (st.key === null ? st : { ...st, key: null, at: 0 })), []);

  /** Push the present onto the undo stack without changing it (start of a drag or resize). */
  const checkpoint = useCallback(() => {
    setS((st) => (st.present ? { past: [...st.past, st.present].slice(-LIMIT), present: st.present, future: [], key: null, at: 0 } : st));
  }, []);

  const undo = useCallback(() => {
    setS((st) => {
      if (!st.present || st.past.length === 0) return st;
      const prev = st.past[st.past.length - 1];
      return { past: st.past.slice(0, -1), present: prev, future: [st.present, ...st.future], key: null, at: 0 };
    });
  }, []);

  const redo = useCallback(() => {
    setS((st) => {
      if (!st.present || st.future.length === 0) return st;
      return { past: [...st.past, st.present], present: st.future[0], future: st.future.slice(1), key: null, at: 0 };
    });
  }, []);

  return { doc: s.present, canUndo: s.past.length > 0, canRedo: s.future.length > 0, reset, apply, checkpoint, seal, undo, redo };
}
