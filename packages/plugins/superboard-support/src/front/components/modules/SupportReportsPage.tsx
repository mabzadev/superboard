"use client";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "@superboard/front-ui/ui/card.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
	downloadSupportReportExport,
	exportSupportReports,
	getSupportReportExport,
	getSupportReports,
	listSupportReportExports,
	type SupportReport,
	type SupportReportExport,
} from "../../api/support/reportsService.js";
import { useSupportI18n } from "../../i18n.js";
import { SupportModulePage as ModulePage } from "../support/SupportModulePage.js";
import { SupportEmpty, SupportMetric } from "../support/SupportUi.js";

export default function SupportReportsPage({ inboxId }: { inboxId?: string } = {}) {
	const { t } = useSupportI18n();

	const { selectedProject } = useProjectSelection();
	const projectRef = selectedProject?.id;
	const [report, setReport] = useState<SupportReport | null>(null);
	const [exports, setExports] = useState<SupportReportExport[]>([]);
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!projectRef) return;
		setLoading(true);
		try {
			const [reportResult, exportResult] = await Promise.all([
				getSupportReports(projectRef, {
					inbox_id: inboxId,
					from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
					to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
				}),
				listSupportReportExports(projectRef, inboxId),
			]);
			setReport(reportResult.data);
			setExports(exportResult.data);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		} finally {
			setLoading(false);
		}
	}, [from, projectRef, to, inboxId]);
	useEffect(() => void load(), [load]);

	useEffect(() => {
		if (
			!projectRef ||
			!exports.some((item) => item.status === "queued" || item.status === "processing")
		) {
			return;
		}
		const timer = window.setInterval(() => {
			void Promise.all(
				exports
					.filter((item) => item.status === "queued" || item.status === "processing")
					.map((item) => getSupportReportExport(projectRef, item.id)),
			)
				.then((results) => {
					const updates = new Map(results.map((result) => [result.data.id, result.data]));
					setExports((current) => current.map((item) => updates.get(item.id) ?? item));
				})
				.catch((cause) => setError(moduleErrorMessage(cause)));
		}, 1500);
		return () => window.clearInterval(timer);
	}, [exports, projectRef]);

	const requestExport = async () => {
		if (!projectRef) return;
		try {
			const result = await exportSupportReports(projectRef, {
				inbox_id: inboxId,
				from: from || undefined,
				to: to || undefined,
			});
			const job = await getSupportReportExport(projectRef, result.data.id);
			setExports((current) => [job.data, ...current.filter((item) => item.id !== job.data.id)]);
			showSuccessNotification(`Report export ${result.data.id} queued`);
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		}
	};

	const downloadExport = async (job: SupportReportExport) => {
		if (!projectRef || job.status !== "completed") return;
		try {
			const blob = await downloadSupportReportExport(projectRef, job.id);
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `support-report-${job.id}.json`;
			anchor.click();
			URL.revokeObjectURL(url);
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		}
	};

	return (
		<ModulePage
			title={t("Reports")}
			description={t(
				"Support volume, response, resolution, backlog, SLA, satisfaction and campaign performance.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-6">
					<div className="flex flex-wrap items-end gap-3">
						<div className="space-y-2">
							<Label>{t("From")}</Label>
							<Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
						</div>
						<div className="space-y-2">
							<Label>{t("To")}</Label>
							<Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
						</div>
						<Button variant="outline" disabled={loading} onClick={() => void load()}>
							<RefreshCw className={loading ? "animate-spin" : ""} /> {t("Apply period")}
						</Button>
						<Button disabled={loading} onClick={() => void requestExport()}>
							<Download /> {t("Export")}
						</Button>
					</div>
					<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
						<SupportMetric
							label={t("Conversations")}
							value={number(report?.totals.conversations)}
						/>
						<SupportMetric label={t("Backlog")} value={number(report?.totals.backlog)} />
						<SupportMetric label={t("Resolved")} value={number(report?.totals.resolved)} />
						<SupportMetric
							label={t("First response")}
							value={duration(report?.totals.first_response_seconds)}
						/>
						<SupportMetric
							label={t("Resolution")}
							value={duration(report?.totals.resolution_seconds)}
						/>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<SupportMetric
							label={t("CSAT")}
							value={
								report?.csat.average == null ? "—" : `${Number(report.csat.average).toFixed(2)} / 5`
							}
							description={`${number(report?.csat.responses)} responses`}
						/>
						<SupportMetric
							label={t("SLA events")}
							value={(report?.sla ?? []).reduce((total, item) => total + Number(item.count), 0)}
							description={
								(report?.sla ?? []).map((item) => `${item.status}: ${item.count}`).join(" · ") ||
								"No SLA events"
							}
						/>
					</div>
					<Tabs defaultValue="inbox">
						<TabsList>
							<TabsTrigger value="inbox">{t("By inbox")}</TabsTrigger>
							<TabsTrigger value="agent">{t("By agent")}</TabsTrigger>
							<TabsTrigger value="team">{t("By team")}</TabsTrigger>
							<TabsTrigger value="label">{t("By label")}</TabsTrigger>
							<TabsTrigger value="channel">{t("By channel")}</TabsTrigger>
							<TabsTrigger value="provider">{t("By provider")}</TabsTrigger>
							<TabsTrigger value="campaigns">{t("Proactive Support")}</TabsTrigger>
						</TabsList>
						<TabsContent value="inbox">
							<Dimension title={t("Inbox volume")} rows={report?.dimensions.inbox ?? []} />
						</TabsContent>
						<TabsContent value="agent">
							<Dimension title={t("Agent load")} rows={report?.dimensions.agent ?? []} />
						</TabsContent>
						<TabsContent value="team">
							<Dimension title={t("Team load")} rows={report?.dimensions.team ?? []} />
						</TabsContent>
						<TabsContent value="label">
							<Dimension title={t("Label volume")} rows={report?.dimensions.label ?? []} />
						</TabsContent>
						<TabsContent value="channel">
							<Dimension title={t("Channel volume")} rows={report?.dimensions.channel ?? []} />
						</TabsContent>
						<TabsContent value="provider">
							<Dimension title={t("Provider volume")} rows={report?.dimensions.provider ?? []} />
						</TabsContent>
						<TabsContent value="campaigns">
							<Dimension
								title={t("Campaign delivery")}
								rows={(report?.proactive_support ?? []).map((item) => ({
									dimension: item.status,
									conversations: item.count,
								}))}
							/>
						</TabsContent>
					</Tabs>
					<Card>
						<CardHeader>
							<CardTitle className="text-base">{t("Report exports")}</CardTitle>
						</CardHeader>
						<CardContent className="space-y-2">
							{exports.length === 0 ? (
								<SupportEmpty
									title={t("No report exports")}
									description={t("Request an export for the selected reporting period.")}
								/>
							) : (
								exports.map((job) => (
									<div
										key={job.id}
										className="flex items-center justify-between gap-3 rounded-md border p-3"
									>
										<div>
											<div className="font-medium">{job.status}</div>
											<div className="text-xs text-muted-foreground">{job.id}</div>
										</div>
										{job.status === "completed" ? (
											<Button variant="outline" onClick={() => void downloadExport(job)}>
												<Download /> {t("Download")}
											</Button>
										) : job.status === "failed" ? (
											<span className="text-sm text-destructive">{t("Export failed")}</span>
										) : (
											<span className="text-sm text-muted-foreground">{t("Processing…")}</span>
										)}
									</div>
								))
							)}
						</CardContent>
					</Card>
				</div>
			)}
		</ModulePage>
	);
}

function Dimension({
	title,
	rows,
}: {
	title: string;
	rows: Array<{ dimension: string; conversations: number }>;
}) {
	const { t } = useSupportI18n();

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">{title}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-2">
				{rows.length === 0 ? (
					<SupportEmpty
						title={t("No data for this period")}
						description={t("Adjust the period or wait for Support activity.")}
					/>
				) : (
					rows.map((row) => (
						<div
							key={row.dimension}
							className="flex items-center justify-between rounded-md border p-3"
						>
							<span>{row.dimension}</span>
							<strong>{number(row.conversations)}</strong>
						</div>
					))
				)}
			</CardContent>
		</Card>
	);
}
function number(value?: number | null) {
	return Number(value || 0).toLocaleString();
}
function duration(value?: number | null) {
	if (value == null) return "—";
	const seconds = Number(value);
	return seconds < 3600 ? `${Math.round(seconds / 60)} min` : `${(seconds / 3600).toFixed(1)} h`;
}
