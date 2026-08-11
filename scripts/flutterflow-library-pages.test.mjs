import assert from "node:assert/strict";
import test from "node:test";

import {
  flutterFlowLibraryPageEnvironmentName,
  resolveFlutterFlowLibraryPage,
} from "./flutterflow-library-pages.mjs";

test("derives stable environment names and validates inspected page keys", () => {
  assert.equal(
    flutterFlowLibraryPageEnvironmentName("SuperBoardOnboardingPage"),
    "FF_LIBRARY_SUPERBOARD_ONBOARDING_PAGE_KEY",
  );
  assert.deepEqual(
    resolveFlutterFlowLibraryPage("SuperBoardOnboardingPage", {
      kind: "page",
      name: "SuperBoardOnboardingPage",
      key: "Scaffold_onboarding123",
      root: { key: "Scaffold_onboarding123" },
    }),
    {
      name: "SuperBoardOnboardingPage",
      key: "Scaffold_onboarding123",
      environment: "FF_LIBRARY_SUPERBOARD_ONBOARDING_PAGE_KEY",
    },
  );
});

test("rejects stale names, invalid keys and contradictory snapshots", () => {
  assert.throws(
    () =>
      resolveFlutterFlowLibraryPage("SuperBoardOnboardingPage", {
        kind: "page",
        name: "SuperBoardPaywallPage",
        key: "Scaffold_paywall",
      }),
    /identifies page:SuperBoardPaywallPage/u,
  );
  assert.throws(
    () =>
      resolveFlutterFlowLibraryPage("SuperBoardOnboardingPage", {
        kind: "page",
        name: "SuperBoardOnboardingPage",
        key: "bad key",
      }),
    /no valid immutable/u,
  );
  assert.throws(
    () =>
      resolveFlutterFlowLibraryPage("SuperBoardOnboardingPage", {
        kind: "page",
        name: "SuperBoardOnboardingPage",
        key: "Scaffold_one",
        root: { key: "Scaffold_two" },
      }),
    /disagree/u,
  );
});
