import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import parityRelease from "../../../../../config/superboard-parity-release.json";
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

  it("renders every active Release submenu without a client rendering error", () => {
    const errors: unknown[][] = [];
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...args) => errors.push(args));
    const release = parityRelease.release.payload;
    const routes = new Map(
      release.front_route_manifest.routes.map((route) => [
        route.route_id,
        route,
      ])
    );
    const submenuItems = release.presentation.navigation.flatMap(
      ({ items }) => items
    );

    try {
      expect(submenuItems).toHaveLength(71);
      for (const item of submenuItems) {
        const route = routes.get(item.route_id);
        expect(route, item.route_id).toBeDefined();
        expect(route?.path_pattern.replace(":lang", "en"), item.route_id).toBe(
          item.href
        );
        const markup = renderView(item.href);
        expect(markup.length, item.href).toBeGreaterThan(100);
        expect(markup, item.href).not.toContain(
          "View configuration is incomplete."
        );
        expect(markup, item.href).not.toContain(
          "No data available for this surface yet."
        );
      }
      expect(errors).toEqual([]);
    } finally {
      errorSpy.mockRestore();
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
