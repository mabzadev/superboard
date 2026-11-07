import DeleteConfirm from "@superboard/front-ui/common/delete-confirm.js";
import { useFrontContext } from "@superboard/front-ui/context";
import { Button, InputArea, Select } from "@superboard/front-ui/kumo";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import { SettingsActions, SettingsRow, SettingsSection } from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { useCallback, useEffect, useId, useState } from "react";

import { mcpText } from "./mcp-i18n.js";
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
const newSession = "new";

export default function McpToolsPage() {
	const { locale } = useFrontContext();
	const t = mcpText(locale);
	const argumentsId = useId();
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
	const date = (value: string) => new Date(value).toLocaleString(locale);
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
		if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error(t("invalid"));
		const response = await POST("/api/v1/mcp/operator/invocations", {
			tool,
			arguments: args,
			...(session ? { session_id: session } : {}),
		});
		setResult(response.data.data);
		setSession(response.data.data.session_id);
	}
	const selected = tools.find((entry) => entry.name === tool);
	const activeSessions = sessions.filter((item) => item.status === "active");
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
			<SettingsSection title={t("tokens")} description={t("tokensDescription")}>
				{tokens.length ? (
					tokens.map((token) => (
						<SettingsRow key={token.id}>
							<div className="flex flex-wrap items-center justify-between gap-3">
								<div className="min-w-0 space-y-1">
									<p className="text-sm font-medium">{token.name}</p>
									<p className="text-xs text-kumo-subtle">
										{t("authorizedOn", { date: date(token.created_at) })}
									</p>
								</div>
								<div className="flex shrink-0 items-center gap-3">
									<Badge variant="success">{t("authorized")}</Badge>
									<DeleteConfirm
										title={t("revokeTitle", { name: token.name })}
										description={t("revokeDescription")}
										confirmText={t("revoke")}
										cancelText={t("cancel")}
										onConfirm={() =>
											run(async () => {
												await DELETE(`/api/v1/mcp/tokens/${encodeURIComponent(token.id)}`);
											})
										}
									>
										<Button type="button" variant="secondary-destructive" disabled={busy}>
											{t("revoke")}
										</Button>
									</DeleteConfirm>
								</div>
							</div>
						</SettingsRow>
					))
				) : (
					<SettingsRow>
						<p className="text-sm text-kumo-subtle">{t("noTokens")}</p>
					</SettingsRow>
				)}
			</SettingsSection>
			<SettingsActions>
				<Button type="button" disabled={busy} onClick={() => void run(async () => {})}>
					{t("refresh")}
				</Button>
			</SettingsActions>
			<div className="space-y-6 border-t border-kumo-line pt-8">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold">{t("advanced")}</h2>
					<p className="text-sm text-kumo-subtle">{t("advancedDescription")}</p>
				</div>
				<SettingsSection title={t("runner")} description={t("runnerDescription")}>
					<SettingsRow>
						<form
							className="space-y-4"
							onSubmit={(event) => {
								event.preventDefault();
								void run(invoke);
							}}
						>
							<Select
								label={t("tool")}
								className="w-full"
								value={tool}
								onValueChange={(value) => {
									if (typeof value === "string") setTool(value);
								}}
								items={Object.fromEntries(tools.map((entry) => [entry.name, entry.name]))}
								description={selected?.description}
							/>
							<details className="text-sm">
								<summary className="cursor-pointer">{t("schema")}</summary>
								<pre className="mt-2 max-h-72 overflow-auto text-xs">
									{JSON.stringify(selected?.inputSchema, null, 2)}
								</pre>
							</details>
							<Select
								label={t("session")}
								className="w-full"
								value={session || newSession}
								onValueChange={(value) => {
									if (typeof value === "string") setSession(value === newSession ? "" : value);
								}}
								items={Object.fromEntries<string>([
									[newSession, String(t("fresh"))],
									...activeSessions.map((item): [string, string] => [
										item.session_id,
										item.session_id,
									]),
								])}
							/>
							<div className="space-y-2">
								<label htmlFor={argumentsId} className="block text-sm font-medium">
									{t("arguments")}
								</label>
								<InputArea
									id={argumentsId}
									className="w-full font-mono"
									rows={6}
									value={argumentsText}
									onChange={(event) => setArgumentsText(event.target.value)}
								/>
							</div>
							<SettingsActions>
								<Button type="submit" disabled={busy || !selected}>
									{t("invoke")}
								</Button>
							</SettingsActions>
						</form>
					</SettingsRow>
					{result !== null && (
						<SettingsRow>
							<h3 className="text-sm font-medium">{t("result")}</h3>
							<pre className="max-h-96 overflow-auto text-xs" role="status">
								{JSON.stringify(result, null, 2)}
							</pre>
						</SettingsRow>
					)}
				</SettingsSection>
				<SettingsSection title={t("sessions")} description={t("sessionsDescription")}>
					{sessions.length ? (
						sessions.map((item) => (
							<SettingsRow key={item.session_id}>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<div className="min-w-0 space-y-1">
										<code className="break-all text-xs">{item.session_id}</code>
										<p className="text-xs text-kumo-subtle">
											{t("expiresOn", { date: date(item.expires_at) })}
										</p>
									</div>
									<Badge variant={item.status === "active" ? "success" : "default"}>
										{item.status === "active" ? t("status:active") : t("status:expired")}
									</Badge>
								</div>
							</SettingsRow>
						))
					) : (
						<SettingsRow>
							<p className="text-sm text-kumo-subtle">{t("empty")}</p>
						</SettingsRow>
					)}
				</SettingsSection>
				<SettingsSection title={t("receipts")} description={t("receiptsDescription")}>
					{receipts.length ? (
						receipts.map((item) => (
							<SettingsRow key={item.receipt_id}>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<div className="min-w-0 space-y-1">
										<p className="text-sm font-medium">{item.tool}</p>
										<p className="text-xs text-kumo-subtle">{date(item.started_at)}</p>
										<p className="break-all text-xs text-kumo-subtle">
											{item.receipt_id} · {item.session_id}
										</p>
										{item.error_code && (
											<p className="text-xs text-kumo-danger">
												{t("errorCode", { code: item.error_code })}
											</p>
										)}
									</div>
									<Badge
										variant={
											item.status === "completed"
												? "success"
												: item.status === "running"
													? "info"
													: "destructive"
										}
									>
										{item.status === "completed"
											? t("status:completed")
											: item.status === "running"
												? t("status:running")
												: t("status:failed")}
									</Badge>
								</div>
							</SettingsRow>
						))
					) : (
						<SettingsRow>
							<p className="text-sm text-kumo-subtle">{t("empty")}</p>
						</SettingsRow>
					)}
					{(cursor || next) && (
						<SettingsRow>
							<SettingsActions>
								{cursor && (
									<Button
										type="button"
										onClick={() => {
											setCursor("");
										}}
									>
										{t("first")}
									</Button>
								)}
								{next && (
									<Button
										type="button"
										onClick={() => {
											setCursor(next);
										}}
									>
										{t("next")}
									</Button>
								)}
							</SettingsActions>
						</SettingsRow>
					)}
				</SettingsSection>
			</div>
		</section>
	);
}
