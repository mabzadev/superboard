import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import navigation from "../../../../../config/superboard-dashboard-navigation.json";
import seed from "../../../../site/seed/seed.json";
import { DashboardViewRenderer } from "../DashboardViewRenderer";

vi.mock("next/navigation", () => import("../next-navigation"));

describe("EmDash Dashboard View renderer", () => {
  it("renders the real Analytics Views interface", () => {
    const markup = renderView("/analytics/views");

    expect(markup).toContain("Tracked views");
    expect(markup).toContain("Top views");
    expect(markup).toContain(
      "Send view.opened, screen.viewed or [CLY]_view events"
    );
  });

  it("renders application content for every editable View", () => {
    const paths = navigation.sections.flatMap((section) =>
      section.pages.map((page) => page.href)
    );

    expect(paths).toHaveLength(71);
    for (const path of paths) {
      const markup = renderView(path);
      expect(markup.length, path).toBeGreaterThan(100);
    }
  });

  it("reports an invalid editable View configuration instead of rendering an empty shell", () => {
    const view = seed.content.views.find(
      ({ data }) => data.path === "/analytics/views"
    );
    if (!view) throw new Error("Missing Analytics Views seed");
    const markup = renderToStaticMarkup(
      <DashboardViewRenderer
        bindings={{ commands: [], data_sources: [] }}
        configurationError="View configuration is incomplete."
        instanceId="local"
        locale="en"
        path={view.data.path}
        pluginId={view.data.plugin_id}
        rendererId={view.data.renderer_id}
      />
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("View configuration is incomplete.");
  });

  it("renders localized Identity paths through the same editable View", () => {
    const view = seed.content.views.find(
      ({ data }) => data.path === "/identity/en/users"
    );
    if (!view) throw new Error("Missing Identity Users seed");
    const markup = renderToStaticMarkup(
      <DashboardViewRenderer
        bindings={view.data.bindings}
        configurationError="Configuration de View incomplète."
        instanceId="local"
        locale="fr"
        path="/identity/fr/users"
        pluginId={view.data.plugin_id}
        rendererId={view.data.renderer_id}
      />
    );

    expect(markup).toContain("Loading Identity configuration");
  });
});

function renderView(path: string): string {
  const view = seed.content.views.find(({ data }) => data.path === path);
  if (!view) throw new Error(`Missing View seed: ${path}`);
  return renderToStaticMarkup(
    <DashboardViewRenderer
      bindings={view.data.bindings}
      configurationError="View configuration is incomplete."
      instanceId="local"
      locale="en"
      path={path}
      pluginId={view.data.plugin_id}
      rendererId={view.data.renderer_id}
    />
  );
}
