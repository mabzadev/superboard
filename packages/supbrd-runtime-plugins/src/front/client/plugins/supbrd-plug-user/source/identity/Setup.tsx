"use client";

import { useFrontContext } from "@superboard/front-ui/context";
import { AlertCircle, Fingerprint, LoaderCircle } from "lucide-react";
import { useEffect, useState, type PropsWithChildren } from "react";
import { Provider, useDispatch } from "react-redux";

import { useProjectSelection } from "../../../../../../../../supbrd-front-ui/src/shared/context/useProjectSelection.js";
import * as identityClient from "../../transport.js";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js";
import { authApi } from "./services/auth/index.js";
import { defaultIdentityConfig } from "./signals/config.js";
import { configSignal, errorSignal } from "./signals/index.js";
import { appSlice } from "./stores/app.js";
import { store, type AppDispatch } from "./stores/index.js";
import useSignalValue from "./useSignalValue.js";

export default function Setup({ children }: PropsWithChildren) {
	return (
		<Provider store={store}>
			<ProjectIdentity>{children}</ProjectIdentity>
		</Provider>
	);
}

function ProjectIdentity({ children }: PropsWithChildren) {
	const dispatch = useDispatch<AppDispatch>();
	const { selectedProject } = useProjectSelection();
	const { operator } = useFrontContext();
	const error = useSignalValue(errorSignal);
	const projectRef = selectedProject?.id ?? null;
	const canAdminister = Boolean(operator && operator.role >= 40);
	const [readyProjectRef, setReadyProjectRef] = useState<string | null>(null);
	const [initializationFailed, setInitializationFailed] = useState(false);

	useEffect(() => {
		dispatch(authApi.util.resetApiState());
		dispatch(appSlice.actions.selectProject(projectRef));
		dispatch(appSlice.actions.storeAcquireAuthToken(async () => ""));
		setReadyProjectRef(null);
		setInitializationFailed(false);
		configSignal.value = defaultIdentityConfig;
		errorSignal.value = "";
		window.sessionStorage.removeItem("superboard.identity.primaryApp");
		if (!projectRef || !canAdminister) return;

		const controller = new AbortController();
		const loadConfiguration = async () => {
			const base = `/api/v1/identity-admin/projects/${encodeURIComponent(projectRef)}`;
			const response = await identityClient.GET(base, { signal: controller.signal });
			const payload = response.data as {
				configs?: Record<string, unknown>;
			};
			if (controller.signal.aborted) return;
			configSignal.value = {
				...defaultIdentityConfig,
				...(payload.configs ?? {}),
			};
			const appsResponse = await identityClient.GET(`${base}/api/v1/apps`, {
				signal: controller.signal,
			});
			const appsPayload = appsResponse.data as {
				apps?: Array<{
					clientId?: unknown;
					isActive?: unknown;
					redirectUris?: unknown;
					type?: unknown;
				}>;
			};
			if (controller.signal.aborted) return;
			const primary = appsPayload.apps?.find(
				(app) =>
					app.type === "spa" &&
					app.isActive === true &&
					typeof app.clientId === "string" &&
					Array.isArray(app.redirectUris) &&
					typeof app.redirectUris[0] === "string",
			);
			if (primary && Array.isArray(primary.redirectUris)) {
				window.sessionStorage.setItem(
					"superboard.identity.primaryApp",
					JSON.stringify({
						clientId: primary.clientId,
						redirectUri: primary.redirectUris[0],
					}),
				);
			}
			setReadyProjectRef(projectRef);
		};
		void loadConfiguration().catch((cause) => {
			if (!controller.signal.aborted) {
				setInitializationFailed(true);
				errorSignal.value =
					cause instanceof Error ? cause.message : "Identity configuration could not be loaded.";
			}
		});
		return () => controller.abort();
	}, [canAdminister, dispatch, projectRef]);

	if (!projectRef) {
		return (
			<div className="flex min-h-80 items-center justify-center gap-3 text-muted-foreground">
				<LoaderCircle className="size-5 animate-spin" />
				Loading the selected project…
			</div>
		);
	}
	if (!canAdminister) {
		return (
			<div className="mx-auto max-w-2xl p-6 md:p-10">
				<Alert variant="destructive">
					<AlertCircle className="size-4" />
					<AlertTitle>Administrator access required</AlertTitle>
					<AlertDescription>
						Identity settings can be changed only by a project owner or administrator.
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	const isReady = readyProjectRef === projectRef;

	return (
		<section className="identity-admin mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-4 md:p-7">
			<div className="flex items-center gap-3 border-b border-border pb-4">
				<span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
					<Fingerprint className="size-5" />
				</span>
				<div>
					<h1 className="text-lg font-semibold tracking-tight">Identity</h1>
					<p className="text-sm text-muted-foreground">
						Authentication, users, organizations, access and SSO for this project.
					</p>
				</div>
			</div>
			{error && (
				<Alert variant="destructive">
					<AlertCircle className="size-4" />
					<AlertTitle>Identity request failed</AlertTitle>
					<AlertDescription className="break-words">{error}</AlertDescription>
				</Alert>
			)}
			{!isReady && !initializationFailed && (
				<div className="flex min-h-64 items-center justify-center gap-3 text-muted-foreground">
					<LoaderCircle className="size-5 animate-spin" />
					Loading Identity configuration…
				</div>
			)}
			{isReady ? children : null}
		</section>
	);
}
