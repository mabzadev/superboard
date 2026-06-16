"use client";

import { useCallback, useEffect, useState } from "react";
import type { MigrationProvider } from "@/types";

// localStorage keys are project-scoped so multiple projects on the same
// browser don't trample each other's wizard state.
const PREFLIGHT_KEY = (projectId: string) =>
  `migration:${projectId}:preflight_done`;
const CUTOVER_KEY = (projectId: string) =>
  `migration:${projectId}:cutover_done`;
const DRAFT_PROVIDER_KEY = (projectId: string) =>
  `migration:${projectId}:draft_provider`;

function readBool(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function readProvider(key: string): MigrationProvider | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(key);
    if (value === "branch" || value === "appsflyer") return value;
    return null;
  } catch {
    return null;
  }
}

function writeString(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // ignore quota / privacy-mode errors — UI continues to function,
    // user just won't have a persisted attestation on this browser.
  }
}

export interface LocalAttestationApi {
  preflightDone: boolean;
  cutoverDone: boolean;
  draftProvider: MigrationProvider | null;
  setPreflightDone: (value: boolean) => void;
  setCutoverDone: (value: boolean) => void;
  setDraftProvider: (value: MigrationProvider | null) => void;
  clearAll: () => void;
}

/**
 * Tiny localStorage wrapper for the wizard's soft attestations.
 * Initial state is read lazily on mount so SSR matches the empty default and
 * we hydrate to the persisted value on the first client render.
 */
export function useLocalAttestation(projectId: string): LocalAttestationApi {
  const [preflightDone, setPreflightDoneState] = useState(false);
  const [cutoverDone, setCutoverDoneState] = useState(false);
  const [draftProvider, setDraftProviderState] =
    useState<MigrationProvider | null>(null);

  // Hydrate on mount / when projectId changes. The wizard is mounted inside a
  // protected route so projectId is stable across the lifecycle, but support
  // the swap anyway.
  useEffect(() => {
    setPreflightDoneState(readBool(PREFLIGHT_KEY(projectId)));
    setCutoverDoneState(readBool(CUTOVER_KEY(projectId)));
    setDraftProviderState(readProvider(DRAFT_PROVIDER_KEY(projectId)));
  }, [projectId]);

  const setPreflightDone = useCallback(
    (value: boolean) => {
      writeString(PREFLIGHT_KEY(projectId), value ? "true" : null);
      setPreflightDoneState(value);
    },
    [projectId]
  );

  const setCutoverDone = useCallback(
    (value: boolean) => {
      writeString(CUTOVER_KEY(projectId), value ? "true" : null);
      setCutoverDoneState(value);
    },
    [projectId]
  );

  const setDraftProvider = useCallback(
    (value: MigrationProvider | null) => {
      writeString(DRAFT_PROVIDER_KEY(projectId), value);
      setDraftProviderState(value);
    },
    [projectId]
  );

  const clearAll = useCallback(() => {
    writeString(PREFLIGHT_KEY(projectId), null);
    writeString(CUTOVER_KEY(projectId), null);
    writeString(DRAFT_PROVIDER_KEY(projectId), null);
    setPreflightDoneState(false);
    setCutoverDoneState(false);
    setDraftProviderState(null);
  }, [projectId]);

  return {
    preflightDone,
    cutoverDone,
    draftProvider,
    setPreflightDone,
    setCutoverDone,
    setDraftProvider,
    clearAll,
  };
}
