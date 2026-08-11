"use client";

import { useCallback, useState } from "react";

type History<T> = { past: T[]; present: T; future: T[] };

export function useEditorHistory<T>(initial: T) {
  const [history, setHistory] = useState<History<T>>({
    past: [],
    present: initial,
    future: [],
  });

  const set = useCallback((next: T | ((current: T) => T)) => {
    setHistory((current) => {
      const value =
        typeof next === "function"
          ? (next as (current: T) => T)(current.present)
          : next;
      if (Object.is(value, current.present)) return current;
      return {
        past: [...current.past.slice(-49), current.present],
        present: value,
        future: [],
      };
    });
  }, []);

  const reset = useCallback((value: T) => {
    setHistory({ past: [], present: value, future: [] });
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous) return current;
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.future[0];
      if (!next) return current;
      return {
        past: [...current.past, current.present],
        present: next,
        future: current.future.slice(1),
      };
    });
  }, []);

  return {
    value: history.present,
    set,
    reset,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
