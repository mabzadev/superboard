"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { Alert, AlertDescription, AlertTitle } from "@superboard/front-ui/ui/alert.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "@superboard/front-ui/ui/card.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import { Switch } from "@superboard/front-ui/ui/switch.js";
import { Textarea } from "@superboard/front-ui/ui/textarea.js";
import { Bot, Play, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import {
	createSupportAssistantTask,
	getSupportAssistantTask,
	listSupportAssistantTasks,
	supportAssistantScenarios,
	supportAssistantTools,
	supportAssistants,
	type SupportAssistantTask,
} from "../../api/support/captainService.js";
import { useSupportI18n } from "../../i18n.js";
import { SupportModulePage as ModulePage } from "../support/SupportModulePage.js";
import {
	SupportEmpty,
	SupportError,
	SupportLoading,
	SupportSearchToolbar,
	SupportStatus,
	SupportViewSelect,
	useSupportCollection,
} from "../support/SupportUi.js";

type CaptainView = "assistants" | "scenarios" | "tools" | "tasks";

const optionLabels: Record<string, string> = {
	suggestion: "Suggestion",
	draft: "Draft",
	automatic: "Automatic",
	suggest_reply: "Suggest a reply",
	summarize: "Summarize",
	translate: "Translate",
	index_document: "Index a document",
	copilot: "Copilot",
	handoff: "Human handoff",
	run_tool: "Run a tool",
};

export default function SupportCaptainPage() {
	const { t, locale } = useSupportI18n();
	const [view, setView] = useState<CaptainView>("assistants");
	const { selectedProject } = useProjectSelection();
	const projectRef = selectedProject?.id;
	const assistants = useSupportCollection(projectRef, supportAssistants.list);
	const scenarios = useSupportCollection(projectRef, supportAssistantScenarios.list);
	const tools = useSupportCollection(projectRef, supportAssistantTools.list);
	const [saving, setSaving] = useState(false);
	const [assistant, setAssistant] = useState({
		name: "",
		description: "",
		instructions: "",
		mode: "suggestion",
		handoff: true,
	});
	const [scenario, setScenario] = useState({
		assistantId: "",
		name: "",
		instructions: "",
	});
	const [tool, setTool] = useState({
		assistantId: "",
		name: "",
		description: "",
		endpoint: "",
		method: "POST",
		allowed: false,
	});
	const [task, setTask] = useState({
		assistantId: "",
		conversationId: "",
		type: "summarize",
		toolId: "",
		argumentsJson: "{}",
	});
	const [tasks, setTasks] = useState<SupportAssistantTask[]>([]);

	useEffect(() => {
		if (!projectRef) return;
		void listSupportAssistantTasks(projectRef, { limit: 20 })
			.then((result) => setTasks(result.data))
			.catch((cause: unknown) => {
				showErrorNotification(moduleErrorMessage(cause, locale));
			});
	}, [projectRef, locale]);

	useEffect(() => {
		if (!projectRef || !tasks.some((item) => item.status === "queued" || item.status === "running"))
			return;
		const timer = window.setInterval(() => {
			void Promise.all(
				tasks
					.filter((item) => item.status === "queued" || item.status === "running")
					.map((item) => getSupportAssistantTask(projectRef, item.id)),
			)
				.then((results) => {
					const updates = new Map(results.map((result) => [result.data.id, result.data]));
					setTasks((current) => current.map((item) => updates.get(item.id) ?? item));
				})
				.catch((cause: unknown) => {
					showErrorNotification(moduleErrorMessage(cause, locale));
				});
		}, 1500);
		return () => window.clearInterval(timer);
	}, [projectRef, tasks, locale]);

	const createAssistant = async () => {
		if (!projectRef || !assistant.name.trim() || !assistant.instructions.trim()) return;
		setSaving(true);
		try {
			await supportAssistants.create(projectRef, {
				name: assistant.name.trim(),
				description: assistant.description.trim() || null,
				instructions: assistant.instructions.trim(),
				response_mode: assistant.mode,
				handoff_enabled: assistant.handoff,
				active: true,
			});
			setAssistant((current) => ({
				...current,
				name: "",
				description: "",
				instructions: "",
				mode: "suggestion",
			}));
			await assistants.reload();
			showSuccessNotification(t("Support assistant created"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};
	const createScenario = async () => {
		if (
			!projectRef ||
			!scenario.assistantId ||
			!scenario.name.trim() ||
			!scenario.instructions.trim()
		)
			return;
		setSaving(true);
		try {
			await supportAssistantScenarios.create(projectRef, {
				assistant_id: scenario.assistantId,
				name: scenario.name.trim(),
				trigger: {},
				instructions: scenario.instructions.trim(),
				position: 0,
				active: true,
			});
			setScenario((current) => ({ ...current, name: "", instructions: "" }));
			await scenarios.reload();
			showSuccessNotification(t("Assistant scenario created"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};
	const createTool = async () => {
		if (
			!projectRef ||
			!tool.assistantId ||
			!tool.name.trim() ||
			!tool.description.trim() ||
			!tool.endpoint.trim()
		)
			return;
		setSaving(true);
		try {
			await supportAssistantTools.create(projectRef, {
				assistant_id: tool.assistantId,
				name: tool.name.trim(),
				description: tool.description.trim(),
				endpoint_url: tool.endpoint.trim(),
				method: tool.method,
				input_schema: { type: "object", properties: {} },
				headers: {},
				allowed: tool.allowed,
			});
			setTool((current) => ({
				...current,
				name: "",
				description: "",
				endpoint: "",
				allowed: false,
			}));
			await tools.reload();
			showSuccessNotification(t("Assistant tool created"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};
	const queueTask = async () => {
		if (!projectRef || !task.assistantId) return;
		if (task.type === "handoff" && !task.conversationId.trim()) {
			showErrorNotification(t("Human handoff requires a conversation ID"));
			return;
		}
		let input: Record<string, unknown> = {};
		if (task.type === "run_tool") {
			if (!task.toolId) {
				showErrorNotification(t("Select an allowlisted tool"));
				return;
			}
			try {
				const argumentsValue: unknown = JSON.parse(task.argumentsJson);
				if (
					!argumentsValue ||
					typeof argumentsValue !== "object" ||
					Array.isArray(argumentsValue)
				) {
					throw new Error("invalid");
				}
				input = { tool_id: task.toolId, arguments: argumentsValue };
			} catch {
				showErrorNotification(t("Tool arguments must be a JSON object"));
				return;
			}
		}
		setSaving(true);
		try {
			const result = await createSupportAssistantTask(projectRef, {
				task_type: task.type as
					| "suggest_reply"
					| "summarize"
					| "translate"
					| "index_document"
					| "copilot"
					| "handoff"
					| "run_tool",
				assistant_id: task.assistantId,
				conversation_id: task.conversationId.trim() || undefined,
				input,
			});
			const created = await getSupportAssistantTask(projectRef, result.data.id);
			setTasks((current) => [
				created.data,
				...current.filter((item) => item.id !== created.data.id),
			]);
			showSuccessNotification(t("Task {id} queued", { id: result.data.id }));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const viewSelect = (
		<SupportViewSelect
			label={t("Show")}
			value={view}
			onChange={setView}
			options={[
				{ value: "assistants", label: t("Assistants") },
				{ value: "scenarios", label: t("Scenarios") },
				{ value: "tools", label: t("Tools") },
				{ value: "tasks", label: t("Tasks") },
			]}
		/>
	);

	return (
		<ModulePage
			title={t("Captain")}
			description={t(
				"Project-isolated assistants, Copilot scenarios, allowlisted tools and traceable tasks.",
			)}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-4">
					{view === "assistants" && (
						<div className="space-y-4">
							<Toolbar collection={assistants} filters={viewSelect} />
							<SupportError message={assistants.error} />
							{assistant.mode === "automatic" ? (
								<Alert>
									<ShieldCheck />
									<AlertTitle>{t("Explicit automatic mode")}</AlertTitle>
									<AlertDescription>
										{t(
											"Automatic sending is enabled only for this assistant. Human handoff remains available.",
										)}
									</AlertDescription>
								</Alert>
							) : null}
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2 text-base">
										<Bot /> {t("New assistant")}
									</CardTitle>
								</CardHeader>
								<CardContent className="grid gap-4 md:grid-cols-2">
									<Field label={t("Name")}>
										<Input
											value={assistant.name}
											onChange={(e) => setAssistant((v) => ({ ...v, name: e.target.value }))}
										/>
									</Field>
									<Field label={t("Description")}>
										<Input
											value={assistant.description}
											onChange={(e) =>
												setAssistant((v) => ({
													...v,
													description: e.target.value,
												}))
											}
										/>
									</Field>
									<Field label={t("Response mode")}>
										<Select
											value={assistant.mode}
											onChange={(mode) => setAssistant((v) => ({ ...v, mode }))}
											options={["suggestion", "draft", "automatic"]}
										/>
									</Field>
									<div className="flex items-center gap-3 pt-7">
										<Switch
											checked={assistant.handoff}
											onCheckedChange={(handoff) => setAssistant((v) => ({ ...v, handoff }))}
										/>
										<Label>{t("Human handoff")}</Label>
									</div>
									<div className="space-y-2 md:col-span-2">
										<Label>{t("Instructions")}</Label>
										<Textarea
											rows={7}
											value={assistant.instructions}
											onChange={(e) =>
												setAssistant((v) => ({
													...v,
													instructions: e.target.value,
												}))
											}
										/>
									</div>
									<div className="flex justify-end md:col-span-2">
										<Button disabled={saving} onClick={() => void createAssistant()}>
											<Plus /> {t("Create assistant")}
										</Button>
									</div>
								</CardContent>
							</Card>
							<ResourceList
								loading={assistants.loading}
								empty={t("No Support assistants")}
								items={assistants.items.map((item) => ({
									id: item.id,
									title: item.name,
									detail: `${t(optionLabels[item.response_mode] ?? item.response_mode)} · ${item.handoff_enabled ? t("Human handoff") : t("No handoff")}`,
									status: item.active ? "active" : "disabled",
								}))}
							/>
						</div>
					)}
					{view === "scenarios" && (
						<div className="space-y-4">
							<Toolbar collection={scenarios} filters={viewSelect} />
							<SupportError message={scenarios.error} />
							<Card>
								<CardHeader>
									<CardTitle className="text-base">{t("New scenario")}</CardTitle>
								</CardHeader>
								<CardContent className="grid gap-4 md:grid-cols-2">
									<Field label={t("Assistant")}>
										<AssistantSelect
											value={scenario.assistantId}
											onChange={(assistantId) => setScenario((v) => ({ ...v, assistantId }))}
											items={assistants.items}
										/>
									</Field>
									<Field label={t("Scenario name")}>
										<Input
											value={scenario.name}
											onChange={(e) => setScenario((v) => ({ ...v, name: e.target.value }))}
										/>
									</Field>
									<div className="space-y-2 md:col-span-2">
										<Label>{t("Scenario instructions")}</Label>
										<Textarea
											rows={6}
											value={scenario.instructions}
											onChange={(e) =>
												setScenario((v) => ({
													...v,
													instructions: e.target.value,
												}))
											}
										/>
									</div>
									<div className="flex justify-end md:col-span-2">
										<Button disabled={saving} onClick={() => void createScenario()}>
											<Plus /> {t("Create scenario")}
										</Button>
									</div>
								</CardContent>
							</Card>
							<ResourceList
								loading={scenarios.loading}
								empty={t("No assistant scenarios")}
								items={scenarios.items.map((item) => ({
									id: item.id,
									title: item.name,
									detail: t("Assistant {id}", { id: item.assistant_id }),
									status: item.active ? "active" : "disabled",
								}))}
							/>
						</div>
					)}
					{view === "tools" && (
						<div className="space-y-4">
							<Toolbar collection={tools} filters={viewSelect} />
							<SupportError message={tools.error} />
							<Card>
								<CardHeader>
									<CardTitle className="text-base">{t("New allowlisted tool")}</CardTitle>
								</CardHeader>
								<CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
									<Field label={t("Assistant")}>
										<AssistantSelect
											value={tool.assistantId}
											onChange={(assistantId) => setTool((v) => ({ ...v, assistantId }))}
											items={assistants.items}
										/>
									</Field>
									<Field label={t("Name")}>
										<Input
											value={tool.name}
											onChange={(e) => setTool((v) => ({ ...v, name: e.target.value }))}
										/>
									</Field>
									<Field label={t("Method")}>
										<Select
											value={tool.method}
											onChange={(method) => setTool((v) => ({ ...v, method }))}
											options={["GET", "POST"]}
										/>
									</Field>
									<Field label={t("Endpoint")}>
										<Input
											type="url"
											value={tool.endpoint}
											onChange={(e) => setTool((v) => ({ ...v, endpoint: e.target.value }))}
										/>
									</Field>
									<Field label={t("Description")}>
										<Input
											value={tool.description}
											onChange={(e) => setTool((v) => ({ ...v, description: e.target.value }))}
										/>
									</Field>
									<div className="flex items-center gap-3 pt-7">
										<Switch
											checked={tool.allowed}
											onCheckedChange={(allowed) => setTool((v) => ({ ...v, allowed }))}
										/>
										<Label>{t("Allow execution")}</Label>
									</div>
									<div className="flex justify-end md:col-span-2 xl:col-span-4">
										<Button disabled={saving} onClick={() => void createTool()}>
											<Plus /> {t("Add tool")}
										</Button>
									</div>
								</CardContent>
							</Card>
							<ResourceList
								loading={tools.loading}
								empty={t("No assistant tools")}
								items={tools.items.map((item) => ({
									id: item.id,
									title: item.name,
									detail: `${item.method} ${item.endpoint_url}`,
									status: item.allowed ? "active" : "disabled",
								}))}
							/>
						</div>
					)}
					{view === "tasks" && (
						<div className="space-y-4">
							<div className="flex flex-wrap items-center gap-2">{viewSelect}</div>
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2 text-base">
										<Play /> {t("Run an assistant task")}
									</CardTitle>
								</CardHeader>
								<CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
									<Field label={t("Assistant")}>
										<AssistantSelect
											value={task.assistantId}
											onChange={(assistantId) => setTask((v) => ({ ...v, assistantId }))}
											items={assistants.items}
										/>
									</Field>
									<Field label={t("Task")}>
										<Select
											value={task.type}
											onChange={(type) => setTask((v) => ({ ...v, type }))}
											options={[
												"suggest_reply",
												"summarize",
												"translate",
												"index_document",
												"copilot",
												"handoff",
												"run_tool",
											]}
										/>
									</Field>
									<Field label={t("Conversation ID (optional)")}>
										<Input
											value={task.conversationId}
											onChange={(e) => setTask((v) => ({ ...v, conversationId: e.target.value }))}
										/>
									</Field>
									{task.type === "run_tool" ? (
										<>
											<Field label={t("Allowlisted tool")}>
												<select
													className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
													value={task.toolId}
													onChange={(event) =>
														setTask((value) => ({
															...value,
															toolId: event.target.value,
														}))
													}
												>
													<option value="">{t("Select tool")}</option>
													{tools.items
														.filter(
															(item) => item.allowed && item.assistant_id === task.assistantId,
														)
														.map((item) => (
															<option key={item.id} value={item.id}>
																{item.name}
															</option>
														))}
												</select>
											</Field>
											<div className="space-y-2 md:col-span-2 xl:col-span-4">
												<Label>{t("Tool arguments (JSON object)")}</Label>
												<Textarea
													rows={5}
													spellCheck={false}
													value={task.argumentsJson}
													onChange={(event) =>
														setTask((value) => ({
															...value,
															argumentsJson: event.target.value,
														}))
													}
												/>
											</div>
										</>
									) : null}
									<div className="flex items-end">
										<Button className="w-full" disabled={saving} onClick={() => void queueTask()}>
											<Play /> {t("Queue task")}
										</Button>
									</div>
								</CardContent>
							</Card>
							{tasks.length === 0 ? (
								<SupportEmpty
									title={t("No assistant tasks")}
									description={t(
										"Run a task to receive a project-isolated result with traceable sources.",
									)}
								/>
							) : (
								<div className="space-y-3">
									{tasks.map((item) => (
										<Card key={item.id}>
											<CardContent className="space-y-2 p-4">
												<div className="flex items-center justify-between gap-3">
													<strong>{t(optionLabels[item.task_type] ?? item.task_type)}</strong>
													<SupportStatus value={item.status} />
												</div>
												{item.result?.text ? (
													<p className="whitespace-pre-wrap text-sm">{item.result.text}</p>
												) : null}
												{item.result?.handoff ? (
													<p className="text-sm">{t("Transferred to a human agent.")}</p>
												) : null}
												{item.result?.tool_id ? (
													<pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
														{JSON.stringify(item.result.output, null, 2)}
													</pre>
												) : null}
												{(item.result?.sources ?? []).length ? (
													<div className="text-xs text-muted-foreground">
														{t("Sources: {sources}", {
															sources: (item.result.sources ?? [])
																.map((source) => source.title)
																.join(" · "),
														})}
													</div>
												) : null}
												{item.error_code ? (
													<div className="text-sm text-destructive">
														{t("Task failed: {code}", { code: item.error_code })}
													</div>
												) : null}
											</CardContent>
										</Card>
									))}
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</ModulePage>
	);
}

type Named = { id: string; name: string };
function AssistantSelect({
	value,
	onChange,
	items,
}: {
	value: string;
	onChange: (value: string) => void;
	items: Named[];
}) {
	const { t } = useSupportI18n();
	return (
		<select
			className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
			value={value}
			onChange={(e) => onChange(e.target.value)}
		>
			<option value="">{t("Select assistant")}</option>
			{items.map((item) => (
				<option key={item.id} value={item.id}>
					{item.name}
				</option>
			))}
		</select>
	);
}
function Toolbar({
	collection,
	filters,
}: {
	collection: ReturnType<typeof useSupportCollection<Named>>;
	filters: ReactNode;
}) {
	return (
		<SupportSearchToolbar
			query={collection.query}
			setQuery={collection.setQuery}
			onSearch={collection.search}
			onRefresh={collection.reload}
			loading={collection.loading}
			filters={filters}
		/>
	);
}
function ResourceList({
	loading,
	items,
	empty,
}: {
	loading: boolean;
	items: Array<{ id: string; title: string; detail: string; status: string }>;
	empty: string;
}) {
	const { t } = useSupportI18n();
	if (loading) return <SupportLoading />;
	if (!items.length)
		return <SupportEmpty title={empty} description={t("Create one with the form above.")} />;
	return (
		<div className="grid gap-3">
			{items.map((item) => (
				<Card key={item.id}>
					<CardContent className="flex items-center justify-between gap-3 p-4">
						<div>
							<p className="font-medium">{item.title}</p>
							<p className="text-sm text-muted-foreground">{item.detail}</p>
						</div>
						<SupportStatus value={item.status} />
					</CardContent>
				</Card>
			))}
		</div>
	);
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="space-y-2">
			<Label>{label}</Label>
			{children}
		</div>
	);
}
function Select({
	value,
	onChange,
	options,
}: {
	value: string;
	onChange: (value: string) => void;
	options: string[];
}) {
	const { t } = useSupportI18n();
	return (
		<select
			className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
			value={value}
			onChange={(e) => onChange(e.target.value)}
		>
			{options.map((option) => (
				<option key={option} value={option}>
					{t(optionLabels[option] ?? option)}
				</option>
			))}
		</select>
	);
}
