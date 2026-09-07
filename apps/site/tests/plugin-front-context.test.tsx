import { FrontContextProvider, type FrontContextValue } from "@superboard/front-ui/context";
import { NavigationProvider, useParams } from "@superboard/front-ui/navigation";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plug-user/source/identity/melody-react.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

const context: FrontContextValue = {
	instanceId: "isolated-front",
	pluginId: "supbrd-plug-user",
	path: "/identity/fr/users/member%2F42",
	locale: "fr",
	parameters: { lang: "fr", authid: "member/42" },
	projectScope: null,
	activePluginIds: ["supbrd-plug-user"],
	operator: { id: "operator-42", email: "operator@example.test", name: null, role: 40 },
};

function Status() {
	const auth = useAuth();
	return (
		<output>
			{JSON.stringify({ authenticated: auth.isAuthenticated, roles: auth.userInfo.roles })}
		</output>
	);
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

describe("plugin operator and route context", () => {
	it("uses the verified operator without reading historical browser credentials", async () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("historical credentials must not be read");
		});
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		await act(async () => {
			root.render(
				<FrontContextProvider value={context}>
					<Status />
				</FrontContextProvider>,
			);
		});
		expect(container.textContent).toBe('{"authenticated":true,"roles":["super_admin"]}');
		await act(async () => root.unmount());
	});
	it("does not grant Identity administration to an absent or lower-permission operator", async () => {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		await act(async () => {
			root.render(
				<FrontContextProvider value={{ ...context, operator: null }}>
					<Status />
				</FrontContextProvider>,
			);
		});
		expect(container.textContent).toBe('{"authenticated":false,"roles":[]}');
		await act(async () => {
			root.render(
				<FrontContextProvider value={{ ...context, operator: { ...context.operator!, role: 10 } }}>
					<Status />
				</FrontContextProvider>,
			);
		});
		expect(container.textContent).toBe('{"authenticated":true,"roles":[]}');
		await act(async () => root.unmount());
	});
	it("passes decoded detail identifiers and locale to the selected page", async () => {
		function Detail() {
			const params = useParams();
			return (
				<output>
					{params.lang}:{params.authid}
				</output>
			);
		}
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		await act(async () => {
			root.render(
				<NavigationProvider path={context.path} parameters={context.parameters}>
					<Detail />
				</NavigationProvider>,
			);
		});
		expect(container.textContent).toBe("fr:member/42");
		await act(async () => root.unmount());
	});
});
