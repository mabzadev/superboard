"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { FlowGraph } from "@/api/flows/flowsService";

type HistoryState = {
  past: FlowGraph[];
  present: FlowGraph;
  future: FlowGraph[];
};

export function useFlowHistory(initialGraph: FlowGraph) {
  const [state, setState] = useState<HistoryState>({
    past: [],
    present: initialGraph,
    future: [],
  });
  const initialRef = useRef(initialGraph);

  useEffect(() => {
    if (initialRef.current !== initialGraph) {
      initialRef.current = initialGraph;
      setState({ past: [], present: initialGraph, future: [] });
    }
  }, [initialGraph]);

  const update = useCallback(
    (next: FlowGraph | ((graph: FlowGraph) => FlowGraph)) => {
      setState((current) => {
        const graph = typeof next === "function" ? next(current.present) : next;
        if (graph === current.present) return current;
        return {
          past: [...current.past.slice(-49), current.present],
          present: graph,
          future: [],
        };
      });
    },
    []
  );

  const updateTransient = useCallback(
    (next: (graph: FlowGraph) => FlowGraph) => {
      setState((current) => ({ ...current, present: next(current.present) }));
    },
    []
  );

  const undo = useCallback(() => {
    setState((current) => {
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
    setState((current) => {
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
    graph: state.present,
    update,
    updateTransient,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
