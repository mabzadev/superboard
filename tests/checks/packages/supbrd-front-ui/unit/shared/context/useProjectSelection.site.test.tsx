import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
	FrontContextProvider,
	type FrontContextValue,
} from "../../../../../../../packages/supbrd-front-ui/src/context.js";
import {
	ProjectSelectionProvider,
	useProjectSelection,
} from "../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js";
const project = {
	id: "42-prod",
	internal_id: "81",
	name: "Production",
	identifier: "production",
	is_test: false,
	created_at: "2026-01-01",
	updated_at: "2026-01-01",
};
const context: FrontContextValue = {
	instanceId: "local",
	pluginId: "supbrd-plug-user",
	path: "/",
	parameters: {},
	locale: "en",
	activePluginIds: ["supbrd-plug-user"],
	operator: { id: "operator", email: "operator@example.test", name: null, role: 50 },
	projectScope: {
		production_project_ref: "42-prod",
		test_project_ref: "42-test",
		instance: {
			id: "42",
			name: "Scoped instance",
			uri_scheme: "scope",
			get_started_dismissed: false,
			created_at: "2026-01-01",
			updated_at: "2026-01-01",
			production: project,
			test: { ...project, id: "42-test", is_test: true },
			projects: [project],
		},
	},
};
describe("Site project selection", () => {
	it("uses server-authorized project references even when the deployment label and browser storage differ", () => {
		localStorage.setItem("current_user", JSON.stringify({ instanceId: "untrusted" }));
		const wrapper = ({ children }: { children: ReactNode }) => (
			<FrontContextProvider value={context}>
				<ProjectSelectionProvider instanceId="local">{children}</ProjectSelectionProvider>
			</FrontContextProvider>
		);
		const { result } = renderHook(() => useProjectSelection(), { wrapper });
		expect(result.current.selectedProject?.id).toBe("42-prod");
		expect(result.current.selectedInstance?.production.id).toBe("42-prod");
		expect(result.current.selectedInstance?.test.id).toBe("42-test");
		localStorage.removeItem("current_user");
	});
});
