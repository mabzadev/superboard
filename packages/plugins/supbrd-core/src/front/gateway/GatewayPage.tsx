import { useFrontContext } from "@superboard/front-ui/context";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../../../../../supbrd-front-ui/src/shared/components/ui/button.js";
import { Input } from "../../../../../supbrd-front-ui/src/shared/components/ui/input.js";
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
const base = "/api/v1/gateway";
const messages = {
	en: {
		title: "Gateway",
		id: "Route identifier",
		method: "Method",
		alias: "Gateway path",
		target: "Target API path",
		limit: "Requests per minute",
		save: "Save draft route",
		new: "New route",
		publish: "Publish gateway manifest",
		published: "Published manifest",
		policy: "Allowed operator IDs (comma separated; empty allows authenticated operators)",
		rotate: "Update access policy",
		test: "Test route",
		parameters: "Route parameters (JSON)",
		payload: "Request body (JSON)",
		result: "Result",
		limits: "Recent rate counters",
		note: "Gateway aliases are available under /api/v1/gateway/proxy. Direct plugin APIs remain available independently.",
	},
	fr: {
		title: "Passerelle",
		id: "Identifiant de route",
		method: "Méthode",
		alias: "Chemin de la passerelle",
		target: "Chemin API cible",
		limit: "Requêtes par minute",
		save: "Enregistrer la route brouillon",
		new: "Nouvelle route",
		publish: "Publier le manifeste",
		published: "Manifeste publié",
		policy:
			"Identifiants des opérateurs autorisés (séparés par des virgules ; vide autorise les opérateurs authentifiés)",
		rotate: "Mettre à jour la politique d’accès",
		test: "Tester la route",
		parameters: "Paramètres de route (JSON)",
		payload: "Corps de la requête (JSON)",
		result: "Résultat",
		limits: "Compteurs récents",
		note: "Les alias sont accessibles sous /api/v1/gateway/proxy. Les API directes des plugins restent disponibles indépendamment.",
	},
};
export default function GatewayPage() {
	const { locale } = useFrontContext();
	const t = messages[locale];
	const [routes, setRoutes] = useState<Route[]>([]);
	const [manifest, setManifest] = useState<Manifest | null>(null);
	const [limits, setLimits] = useState<unknown>([]);
	const [id, setId] = useState("");
	const [method, setMethod] = useState("GET");
	const [alias, setAlias] = useState("");
	const [target, setTarget] = useState("/health");
	const [limit, setLimit] = useState(60);
	const [revision, setRevision] = useState<number | null>(null);
	const [operators, setOperators] = useState("");
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
		]);
		setRoutes(draft.data.data);
		setManifest(active.data.data);
		setLimits(counters.data.data);
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
		<section className="grid gap-5 p-6">
			<h1 className="text-xl font-semibold">{t.title}</h1>
			<p>{t.note}</p>
			{error && <p role="alert">{error}</p>}
			<div className="flex flex-wrap gap-3">
				<Button onClick={() => select()}>{t.new}</Button>
				{routes.map((route) => (
					<Button variant="outline" key={route.route_id} onClick={() => select(route)}>
						{route.method} {route.path_pattern}
					</Button>
				))}
			</div>
			<form
				className="grid gap-3 md:grid-cols-2"
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
				<label>
					{t.id}
					<Input
						value={id}
						disabled={revision !== null}
						onChange={(event) => setId(event.target.value)}
						required
					/>
				</label>
				<label>
					{t.method}
					<select value={method} onChange={(event) => setMethod(event.target.value)}>
						{["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => (
							<option key={value}>{value}</option>
						))}
					</select>
				</label>
				<label>
					{t.alias}
					<Input value={alias} onChange={(event) => setAlias(event.target.value)} required />
				</label>
				<label>
					{t.target}
					<Input value={target} onChange={(event) => setTarget(event.target.value)} required />
				</label>
				<label>
					{t.limit}
					<Input
						type="number"
						min={1}
						max={10000}
						value={limit}
						onChange={(event) => setLimit(Number(event.target.value))}
					/>
				</label>
				<Button type="submit" disabled={busy}>
					{t.save}
				</Button>
			</form>
			<Button
				disabled={busy || !routes.length}
				onClick={() =>
					void run(async () => {
						setResult((await POST(`${base}/manifests`, {})).data.data);
					})
				}
			>
				{t.publish}
			</Button>
			{manifest && (
				<p>
					{t.published}: <code>{manifest.manifest_id}</code>
				</p>
			)}
			<form
				className="grid gap-3"
				onSubmit={(event) => {
					event.preventDefault();
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
					});
				}}
			>
				<label>
					{t.policy}
					<Input value={operators} onChange={(event) => setOperators(event.target.value)} />
				</label>
				<Button type="submit" disabled={busy}>
					{t.rotate}
				</Button>
			</form>
			{manifest && (
				<div className="grid gap-3">
					<label>
						{t.parameters}
						<textarea
							className="w-full rounded border p-3 font-mono"
							value={parameters}
							onChange={(event) => setParameters(event.target.value)}
						/>
					</label>
					<label>
						{t.payload}
						<textarea
							className="w-full rounded border p-3 font-mono"
							value={payload}
							onChange={(event) => setPayload(event.target.value)}
						/>
					</label>
					{manifest.routes.map((route) => (
						<Button
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
							{t.test}: {route.route_id}
						</Button>
					))}
				</div>
			)}
			{result !== null && (
				<section>
					<h2>{t.result}</h2>
					<pre className="max-h-96 overflow-auto">{JSON.stringify(result, null, 2)}</pre>
				</section>
			)}
			<details>
				<summary>{t.limits}</summary>
				<pre>{JSON.stringify(limits, null, 2)}</pre>
			</details>
		</section>
	);
}
