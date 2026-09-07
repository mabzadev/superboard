import { useFrontContext } from "@superboard/front-ui/context";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../../../../../../supbrd-front-ui/src/shared/components/ui/button.js";
import { Textarea } from "../../../../../../supbrd-front-ui/src/shared/components/ui/textarea.js";
import { DELETE, GET, POST } from "./transport.js";

interface Tool {
	name: string;
	description?: string;
	inputSchema: unknown;
}
interface Session {
	session_id: string;
	status: string;
	expires_at: string;
}
interface Receipt {
	receipt_id: string;
	session_id: string;
	tool: string;
	status: string;
	started_at: string;
	error_code?: string;
}
interface Token {
	id: string;
	name: string;
	created_at: string;
}
const messages = {
	en: {
		title: "MCP tools",
		refresh: "Refresh",
		tool: "Tool",
		arguments: "Arguments (JSON)",
		invoke: "Run tool",
		session: "Invocation session",
		fresh: "Start a new session",
		sessions: "Invocation sessions",
		note: "A session groups your calls for 15 minutes. Each call uses a temporary credential which is revoked when it finishes.",
		receipt: "Invocation receipts",
		result: "Tool result",
		schema: "Expected arguments",
		next: "Next receipts",
		first: "First receipts",
		tokens: "Authorized applications",
		revoke: "Revoke access",
		completed: "Completed",
		failed: "Failed",
		running: "Running",
		active: "Active",
		expired: "Expired",
		empty: "No records yet.",
		invalid: "Arguments must be a JSON object.",
		providerOff: "Required plugin is disabled",
	},
	fr: {
		title: "Outils MCP",
		refresh: "Actualiser",
		tool: "Outil",
		arguments: "Arguments (JSON)",
		invoke: "Exécuter l’outil",
		session: "Session d’invocation",
		fresh: "Commencer une nouvelle session",
		sessions: "Sessions d’invocation",
		note: "Une session regroupe vos appels pendant 15 minutes. Chaque appel utilise un accès temporaire révoqué dès sa fin.",
		receipt: "Reçus d’invocation",
		result: "Résultat de l’outil",
		schema: "Arguments attendus",
		next: "Reçus suivants",
		first: "Premiers reçus",
		tokens: "Applications autorisées",
		revoke: "Révoquer l’accès",
		completed: "Terminé",
		failed: "Échec",
		running: "En cours",
		active: "Active",
		expired: "Expirée",
		empty: "Aucun enregistrement.",
		invalid: "Les arguments doivent être un objet JSON.",
		providerOff: "Le plugin requis est désactivé",
	},
};
export default function McpToolsPage() {
	const { locale } = useFrontContext();
	const t = messages[locale];
	const [tools, setTools] = useState<Tool[]>([]);
	const [tool, setTool] = useState("get_status");
	const [argumentsText, setArgumentsText] = useState("{}");
	const [sessions, setSessions] = useState<Session[]>([]);
	const [session, setSession] = useState("");
	const [receipts, setReceipts] = useState<Receipt[]>([]);
	const [tokens, setTokens] = useState<Token[]>([]);
	const [cursor, setCursor] = useState("");
	const [next, setNext] = useState<string | null>(null);
	const [result, setResult] = useState<unknown>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const load = useCallback(async () => {
		const results = await Promise.allSettled([
			GET("/api/v1/mcp/operator/tools"),
			GET("/api/v1/mcp/operator/sessions"),
			GET(`/api/v1/mcp/operator/receipts?cursor=${encodeURIComponent(cursor)}`),
			GET("/api/v1/mcp/tokens"),
		]);
		const [toolList, sessionList, receiptList, tokenList] = results;
		if (toolList.status === "fulfilled") setTools(toolList.value.data.data.tools ?? []);
		if (sessionList.status === "fulfilled") setSessions(sessionList.value.data.data.items);
		if (receiptList.status === "fulfilled") {
			setReceipts(receiptList.value.data.data.items);
			setNext(receiptList.value.data.data.next_cursor);
		}
		if (tokenList.status === "fulfilled") setTokens(tokenList.value.data.tokens);
		const failure = results.find((item) => item.status === "rejected");
		if (failure?.status === "rejected") throw failure.reason;
	}, [cursor]);
	useEffect(() => {
		void load().catch((cause) => setError(String(cause)));
	}, [load]);
	async function run(work: () => Promise<void>) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await work();
			await load();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	}
	async function invoke() {
		const args: unknown = JSON.parse(argumentsText);
		if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error(t.invalid);
		const response = await POST("/api/v1/mcp/operator/invocations", {
			tool,
			arguments: args,
			...(session ? { session_id: session } : {}),
		});
		setResult(response.data.data);
		setSession(response.data.data.session_id);
	}
	return (
		<section className="mx-auto grid max-w-6xl gap-5 p-6">
			<h1 className="text-2xl font-semibold">{t.title}</h1>
			<p>{t.note}</p>
			{error && <p role="alert">{error}</p>}
			<Button disabled={busy} onClick={() => void run(async () => {})}>
				{t.refresh}
			</Button>
			<form
				className="grid gap-4 rounded border p-5"
				onSubmit={(event) => {
					event.preventDefault();
					void run(invoke);
				}}
			>
				<label>
					{t.tool}
					<select
						className="block w-full rounded border bg-background p-2"
						value={tool}
						onChange={(event) => setTool(event.target.value)}
					>
						{tools.map((entry) => (
							<option key={entry.name} value={entry.name}>
								{entry.name}
							</option>
						))}
					</select>
				</label>
				<p>{tools.find((entry) => entry.name === tool)?.description}</p>
				<details>
					<summary>{t.schema}</summary>
					<pre className="overflow-auto">
						{JSON.stringify(tools.find((entry) => entry.name === tool)?.inputSchema, null, 2)}
					</pre>
				</details>
				<label>
					{t.session}
					<select
						className="block w-full rounded border bg-background p-2"
						value={session}
						onChange={(event) => setSession(event.target.value)}
					>
						<option value="">{t.fresh}</option>
						{sessions
							.filter((item) => item.status === "active")
							.map((item) => (
								<option key={item.session_id} value={item.session_id}>
									{item.session_id}
								</option>
							))}
					</select>
				</label>
				<label>
					{t.arguments}
					<Textarea
						rows={6}
						value={argumentsText}
						onChange={(event) => setArgumentsText(event.target.value)}
					/>
				</label>
				<Button type="submit" disabled={busy || !tools.some((entry) => entry.name === tool)}>
					{t.invoke}
				</Button>
			</form>
			{result !== null && (
				<div>
					<h2>{t.result}</h2>
					<pre className="max-h-96 overflow-auto rounded border p-3" role="status">
						{JSON.stringify(result, null, 2)}
					</pre>
				</div>
			)}
			<h2>{t.sessions}</h2>
			<ul>
				{sessions.map((item) => (
					<li key={item.session_id}>
						<code>{item.session_id}</code> · {item.status === "active" ? t.active : t.expired} ·{" "}
						{new Date(item.expires_at).toLocaleString(locale)}
					</li>
				))}
			</ul>
			<h2>{t.receipt}</h2>
			{!receipts.length && <p>{t.empty}</p>}
			<ul className="grid gap-2">
				{receipts.map((item) => (
					<li key={item.receipt_id} className="rounded border p-3">
						{item.tool} ·{" "}
						{item.status === "completed"
							? t.completed
							: item.status === "running"
								? t.running
								: t.failed}{" "}
						· {new Date(item.started_at).toLocaleString(locale)}
						<p className="break-all text-xs">
							{item.receipt_id} · {item.session_id}
						</p>
						{item.error_code && <p>{item.error_code}</p>}
					</li>
				))}
			</ul>
			<div className="flex gap-3">
				{cursor && <Button onClick={() => setCursor("")}>{t.first}</Button>}
				{next && <Button onClick={() => setCursor(next)}>{t.next}</Button>}
			</div>
			<h2>{t.tokens}</h2>
			{!tokens.length && <p>{t.empty}</p>}
			<ul className="grid gap-3">
				{tokens.map((token) => (
					<li key={token.id} className="flex items-center justify-between gap-3 rounded border p-3">
						{token.name}
						<Button
							disabled={busy}
							variant="destructive"
							onClick={() =>
								void run(async () => {
									await DELETE(`/api/v1/mcp/tokens/${encodeURIComponent(token.id)}`);
								})
							}
						>
							{t.revoke}
						</Button>
					</li>
				))}
			</ul>
		</section>
	);
}
