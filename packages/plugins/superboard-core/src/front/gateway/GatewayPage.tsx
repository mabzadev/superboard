import { useFrontContext } from "@superboard/front-ui/context";
import { Button, Input, InputArea, Select } from "@superboard/front-ui/kumo";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import { SettingsActions, SettingsRow, SettingsSection } from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import {
	Table as FrontTable,
	TableHeader as FrontTableHeader,
	TableBody as FrontTableBody,
	TableRow as FrontTableRow,
	TableHead as FrontTableHead,
	TableCell as FrontTableCell,
} from "@superboard/front-ui/ui/table.js";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { gatewayText } from "./gateway-i18n.js";
import { GET, POST, PUT } from "./transport.js";

interface Route {
	route_id: string;
	method: string;
	path_pattern: string;
	target_path: string;
	rate_limit: number;
	revision: number;
}
interface Manifest {
	manifest_id: string;
	checksum: string;
	routes: Route[];
}
interface Counter {
	route_id: string;
	window_start: number;
	requests: number;
}
const base = "/api/v1/gateway";
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function isCounter(value: unknown): value is Counter {
	return (
		typeof value === "object" &&
		value !== null &&
		"route_id" in value &&
		typeof value.route_id === "string" &&
		"window_start" in value &&
		typeof value.window_start === "number" &&
		"requests" in value &&
		typeof value.requests === "number"
	);
}

function publication(route: Route, manifest: Manifest | null) {
	const published = manifest?.routes.find((item) => item.route_id === route.route_id);
	if (!published) return "draft";
	const same =
		published.method === route.method &&
		published.path_pattern === route.path_pattern &&
		published.target_path === route.target_path &&
		published.rate_limit === route.rate_limit;
	return same ? "published" : "changed";
}

function allowedOperators(body: unknown): string[] | null {
	if (typeof body !== "object" || body === null || !("access_policy" in body)) return null;
	const policy: unknown = body.access_policy;
	if (typeof policy !== "object" || policy === null || !("allowed_operator_ids" in policy))
		return null;
	const ids: unknown = policy.allowed_operator_ids;
	return Array.isArray(ids) && ids.every((id) => typeof id === "string") ? ids : null;
}

export default function GatewayPage() {
	const { locale } = useFrontContext();
	const t = gatewayText(locale);
	const number = new Intl.NumberFormat(locale);
	const [routes, setRoutes] = useState<Route[]>([]);
	const [manifest, setManifest] = useState<Manifest | null>(null);
	const [limits, setLimits] = useState<Counter[]>([]);
	const [id, setId] = useState("");
	const [method, setMethod] = useState("GET");
	const [alias, setAlias] = useState("");
	const [target, setTarget] = useState("/health");
	const [limit, setLimit] = useState(60);
	const [revision, setRevision] = useState<number | null>(null);
	const [operators, setOperators] = useState("");
	const [policyLoaded, setPolicyLoaded] = useState<boolean | null>(null);
	const operatorsEdited = useRef(false);
	const [parameters, setParameters] = useState("{}");
	const [payload, setPayload] = useState("{}");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<unknown>(null);
	const load = useCallback(async () => {
		const [draft, active, counters] = await Promise.all([
			GET(`${base}/routes`),
			GET(`${base}/active-manifest`),
			GET(`${base}/rate-limits`),
		]).catch((cause: unknown) => {
			setPolicyLoaded(false);
			throw cause;
		});
		const body: unknown = counters.data;
		const rows: unknown = body && typeof body === "object" ? Reflect.get(body, "data") : undefined;
		const allowed = allowedOperators(draft.data);
		setPolicyLoaded(allowed !== null);
		if (allowed && !operatorsEdited.current) setOperators(allowed.join(", "));
		setRoutes(draft.data.data);
		setManifest(active.data.data);
		setLimits(Array.isArray(rows) ? rows.filter(isCounter) : []);
	}, []);
	useEffect(() => {
		void load().catch((cause) => setError(String(cause)));
	}, [load]);
	async function run(action: () => Promise<void>) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await action();
			await load();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	}
	function select(route?: Route) {
		setId(route?.route_id ?? "");
		setMethod(route?.method ?? "GET");
		setAlias(route?.path_pattern ?? "");
		setTarget(route?.target_path ?? "/health");
		setLimit(route?.rate_limit ?? 60);
		setRevision(route?.revision ?? null);
	}
	return (
		<section className="ds-page space-y-8">
			<header className="ds-page-header">
				<div>
					<h1 className="ds-page-title">{t("title")}</h1>
					<p className="ds-page-description">{t("description")}</p>
				</div>
			</header>
			<SectionNavigation />
			{error && (
				<p role="alert" className="text-sm text-kumo-danger">
					{error}
				</p>
			)}
			<SettingsSection title={t("routes")} description={t("routesDescription")}>
				{routes.length ? (
					routes.map((route) => {
						const state = publication(route, manifest);
						return (
							<SettingsRow key={route.route_id}>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<div className="min-w-0 space-y-1">
										<Button
											type="button"
											variant="ghost"
											className="font-mono"
											aria-pressed={revision !== null && id === route.route_id}
											onClick={() => {
												select(route);
											}}
										>
											{`${route.method} ${route.path_pattern}`}
										</Button>
										<p className="text-xs text-kumo-subtle">
											{t("forwardsTo")} <code>{route.target_path}</code> ·{" "}
											{t("perMinute", { count: number.format(route.rate_limit) })}
										</p>
									</div>
									<Badge
										variant={
											state === "published"
												? "success"
												: state === "changed"
													? "warning"
													: "default"
										}
									>
										{t(`route:${state}`)}
									</Badge>
								</div>
							</SettingsRow>
						);
					})
				) : (
					<SettingsRow>
						<p className="text-sm text-kumo-subtle">{t("noRoutes")}</p>
					</SettingsRow>
				)}
				<SettingsRow>
					<SettingsActions>
						<Button
							type="button"
							onClick={() => {
								select();
							}}
						>
							{t("new")}
						</Button>
					</SettingsActions>
				</SettingsRow>
			</SettingsSection>
			<SettingsSection
				title={revision !== null ? t("editRoute") : t("newRoute")}
				description={t("editorDescription")}
			>
				<SettingsRow>
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							void run(async () => {
								const response = await PUT(`${base}/routes/${encodeURIComponent(id)}`, {
									method,
									path_pattern: alias,
									target_path: target,
									rate_limit: limit,
									expected_revision: revision,
								});
								setRevision(response.data.data.revision);
							});
						}}
					>
						<Field label={t("id")}>
							<Input
								className="w-full"
								value={id}
								disabled={revision !== null}
								onChange={(event) => setId(event.target.value)}
								required
							/>
						</Field>
						<Select
							label={t("method")}
							className="w-full"
							value={method}
							onValueChange={(value) => {
								if (typeof value === "string") setMethod(value);
							}}
							items={Object.fromEntries(methods.map((value) => [value, value]))}
						/>
						<Field label={t("alias")}>
							<Input
								className="w-full"
								value={alias}
								onChange={(event) => {
									setAlias(event.target.value);
								}}
								required
							/>
						</Field>
						<Field label={t("target")}>
							<Input
								className="w-full"
								value={target}
								onChange={(event) => {
									setTarget(event.target.value);
								}}
								required
							/>
						</Field>
						<Field label={t("limit")}>
							<Input
								className="w-full"
								type="number"
								min={1}
								max={10000}
								value={limit}
								onChange={(event) => setLimit(Number(event.target.value))}
							/>
						</Field>
						<SettingsActions>
							<Button type="submit" disabled={busy}>
								{t("save")}
							</Button>
						</SettingsActions>
					</form>
				</SettingsRow>
			</SettingsSection>
			<SettingsSection title={t("publication")} description={t("publicationDescription")}>
				<SettingsRow>
					<div className="flex items-center justify-between gap-4">
						<div className="min-w-0 space-y-1">
							<p className="text-sm font-medium">{t("manifest")}</p>
							{manifest && (
								<p className="break-all text-xs text-kumo-subtle">
									{t("manifestId", { id: manifest.manifest_id })}
								</p>
							)}
						</div>
						<Badge variant={manifest ? "success" : "default"}>
							{manifest ? t("manifest:published") : t("manifest:none")}
						</Badge>
					</div>
					<SettingsActions>
						<Button
							type="button"
							disabled={busy || !routes.length}
							onClick={() =>
								void run(async () => {
									setResult((await POST(`${base}/manifests`, {})).data.data);
								})
							}
						>
							{t("publish")}
						</Button>
					</SettingsActions>
				</SettingsRow>
			</SettingsSection>
			<SettingsSection title={t("access")} description={t("accessDescription")}>
				<SettingsRow>
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (policyLoaded !== true) return;
							void run(async () => {
								setResult(
									(
										await POST(`${base}/access-policy`, {
											allowed_operator_ids: operators
												.split(",")
												.map((value) => value.trim())
												.filter(Boolean),
										})
									).data.data,
								);
								operatorsEdited.current = false;
							});
						}}
					>
						<Field label={t("policy")}>
							<Input
								className="w-full"
								value={operators}
								disabled={policyLoaded !== true}
								onChange={(event) => {
									operatorsEdited.current = true;
									setOperators(event.target.value);
								}}
							/>
						</Field>
						{policyLoaded === false && (
							<p role="alert" className="text-sm text-kumo-danger">
								{t("policyUnavailable")}
							</p>
						)}
						<SettingsActions>
							<Button type="submit" disabled={busy || policyLoaded !== true}>
								{t("rotate")}
							</Button>
						</SettingsActions>
					</form>
				</SettingsRow>
			</SettingsSection>
			<div className="space-y-6 border-t border-kumo-line pt-8">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold">{t("advanced")}</h2>
					<p className="text-sm text-kumo-subtle">{t("advancedDescription")}</p>
				</div>
				{manifest && (
					<SettingsSection title={t("testTitle")} description={t("testDescription")}>
						<SettingsRow>
							<Field label={t("parameters")}>
								<InputArea
									className="w-full font-mono"
									value={parameters}
									onChange={(event) => setParameters(event.target.value)}
								/>
							</Field>
							<Field label={t("payload")}>
								<InputArea
									className="w-full font-mono"
									value={payload}
									onChange={(event) => setPayload(event.target.value)}
								/>
							</Field>
							<SettingsActions>
								{manifest.routes.map((route) => (
									<Button
										type="button"
										disabled={busy}
										key={route.route_id}
										onClick={() =>
											void run(async () => {
												setResult(
													(
														await POST(`${base}/invoke/${route.route_id}`, {
															parameters: JSON.parse(parameters),
															...(route.method !== "GET" ? { body: JSON.parse(payload) } : {}),
														})
													).data,
												);
											})
										}
									>
										{t("test", { route: route.route_id })}
									</Button>
								))}
							</SettingsActions>
						</SettingsRow>
					</SettingsSection>
				)}
				{result !== null && (
					<SettingsSection title={t("result")} description={t("resultDescription")}>
						<SettingsRow>
							<pre className="max-h-96 overflow-auto text-xs">
								{JSON.stringify(result, null, 2)}
							</pre>
						</SettingsRow>
					</SettingsSection>
				)}
				<SettingsSection title={t("limits")} description={t("limitsDescription")}>
					<SettingsRow>
						{limits.length ? (
							<div className="overflow-x-auto">
								<FrontTable className="w-full text-start">
									<FrontTableHeader>
										<FrontTableRow>
											<FrontTableHead scope="col">{t("route")}</FrontTableHead>
											<FrontTableHead scope="col">{t("minute")}</FrontTableHead>
											<FrontTableHead scope="col">{t("requests")}</FrontTableHead>
										</FrontTableRow>
									</FrontTableHeader>
									<FrontTableBody>
										{limits.map((counter) => (
											<FrontTableRow key={`${counter.route_id}:${counter.window_start}`}>
												<FrontTableCell className="font-mono text-xs">
													{counter.route_id}
												</FrontTableCell>
												<FrontTableCell>
													{new Date(counter.window_start * 60_000).toLocaleTimeString(locale, {
														hour: "2-digit",
														minute: "2-digit",
													})}
												</FrontTableCell>
												<FrontTableCell>{number.format(counter.requests)}</FrontTableCell>
											</FrontTableRow>
										))}
									</FrontTableBody>
								</FrontTable>
							</div>
						) : (
							<p className="text-sm text-kumo-subtle">{t("noLimits")}</p>
						)}
					</SettingsRow>
				</SettingsSection>
			</div>
		</section>
	);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<label className="block space-y-2">
			<span className="block text-sm font-medium">{label}</span>
			{children}
		</label>
	);
}
