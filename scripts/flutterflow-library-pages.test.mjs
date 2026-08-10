import assert from "node:assert/strict";
import test from "node:test";

import {
  flutterFlowLibraryPageEnvironmentName,
  resolveFlutterFlowLibraryPage,
} from "./flutterflow-library-pages.mjs";

test("derives stable environment names and validates inspected page keys", () => {
  assert.equal(
    flutterFlowLibraryPageEnvironmentName("OpenGrowOnboardingPage"),
    "FF_LIBRARY_OPEN_GROW_ONBOARDING_PAGE_KEY",
  );
  assert.deepEqual(
    resolveFlutterFlowLibraryPage("OpenGrowOnboardingPage", {
      kind: "page",
      name: "OpenGrowOnboardingPage",
      key: "Scaffold_onboarding123",
      root: { key: "Scaffold_onboarding123" },
    }),
    {
      name: "OpenGrowOnboardingPage",
      key: "Scaffold_onboarding123",
      environment: "FF_LIBRARY_OPEN_GROW_ONBOARDING_PAGE_KEY",
    },
  );
});

test("rejects stale names, invalid keys and contradictory snapshots", () => {
  assert.throws(
    () =>
      resolveFlutterFlowLibraryPage("OpenGrowOnboardingPage", {
        kind: "page",
        name: "OpenGrowPaywallPage",
        key: "Scaffold_paywall",
      }),
    /identifies page:OpenGrowPaywallPage/u,
  );
  assert.throws(
    () =>
      resolveFlutterFlowLibraryPage("OpenGrowOnboardingPage", {
        kind: "page",
        name: "OpenGrowOnboardingPage",
        key: "bad key",
      }),
    /no valid immutable/u,
  );
  assert.throws(
    () =>
      resolveFlutterFlowLibraryPage("OpenGrowOnboardingPage", {
        kind: "page",
        name: "OpenGrowOnboardingPage",
        key: "Scaffold_one",
        root: { key: "Scaffold_two" },
      }),
    /disagree/u,
  );
});
