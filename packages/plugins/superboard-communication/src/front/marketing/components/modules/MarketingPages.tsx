"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@superboard/front-ui/ui/card.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import {
	Table as FrontTable,
	TableHeader as FrontTableHeader,
	TableBody as FrontTableBody,
	TableRow as FrontTableRow,
	TableHead as FrontTableHead,
	TableCell as FrontTableCell,
} from "@superboard/front-ui/ui/table.js";
import { RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
	discardMarketingDeadLetter,
	getDeliveryOutbox,
	getEmailCampaigns,
	getMarketingAudit,
	getMarketingDeadLetters,
	getMarketingStatistics,
	replayMarketingDeadLetter,
	retryDeliveryOutbox,
	type DeliveryOutboxItem,
	type EmailCampaign,
	type MarketingDeadLetter,
	type MarketingStatistics as Statistics,
} from "../../api/marketing/marketingService.js";
import { EmailInsights } from "../../studio/EmailInsights.js";
import { useStudioI18n } from "../../studio/i18n.js";

const selectClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";

export function MarketingStatistics() {
	const { t, locale } = useStudioI18n();
	const { selectedProject } = useProjectSelection();
	const [statistics, setStatistics] = useState<Statistics>();
	const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
	const [campaignId, setCampaignId] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [interval, setInterval] = useState("day");
	const [from, setFrom] = useState(
		new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
	);
	const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const filters = {
				from: `${from}T00:00:00.000Z`,
				to: `${to}T23:59:59.999Z`,
				interval,
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				...(campaignId ? { campaign_id: campaignId } : {}),
			};
			const [result, campaignRows] = await Promise.all([
				getMarketingStatistics(selectedProject.id, filters),
				getEmailCampaigns(selectedProject.id),
			]);
			setStatistics(result);
			setCampaigns(campaignRows);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
		}
	}, [campaignId, from, interval, selectedProject, to, locale]);
	useEffect(() => void load(), [load]);
	if (!selectedProject) return <EmptyProject />;
	return (
		<div className="space-y-6">
			<p className="text-sm text-kumo-subtle">
				{t("Delivery, opens, clicks, bounces, complaints, unsubscribes and campaign progression.")}
			</p>
			{error && <p role="alert">{error}</p>}
			<div className="flex flex-wrap gap-2">
				<Input
					aria-label={t("Statistics from")}
					type="date"
					className="w-auto"
					value={from}
					onChange={(event) => setFrom(event.target.value)}
				/>
				<Input
					aria-label={t("Statistics to")}
					type="date"
					className="w-auto"
					value={to}
					onChange={(event) => setTo(event.target.value)}
				/>
				<select
					aria-label={t("Statistics interval")}
					className={`${selectClass} w-auto`}
					value={interval}
					onChange={(event) => setInterval(event.target.value)}
				>
					<option value="hour">{t("Hour")}</option>
					<option value="day">{t("Day")}</option>
					<option value="week">{t("Week")}</option>
					<option value="month">{t("Month")}</option>
				</select>
				<select
					aria-label={t("Statistics campaign")}
					className={`${selectClass} min-w-56 w-auto`}
					value={campaignId}
					onChange={(event) => setCampaignId(event.target.value)}
				>
					<option value="">{t("All campaigns")}</option>
					{campaigns.map((campaign) => (
						<option key={campaign.id} value={campaign.id}>
							{campaign.name}
						</option>
					))}
				</select>
				<Button variant="outline" onClick={() => void load()}>
					<RefreshCw />
					{t("Refresh")}
				</Button>
			</div>
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				{Object.entries(statistics?.totals || {}).map(([key, value]) => (
					<Card key={key}>
						<CardHeader>
							<CardDescription>{t(metricLabel(key))}</CardDescription>
							<CardTitle>
								{key.endsWith("_rate")
									? `${Number(value).toLocaleString(locale)}%`
									: Number(value).toLocaleString(locale)}
							</CardTitle>
						</CardHeader>
					</Card>
				))}
			</div>
			<EmailInsights
				project={selectedProject.id}
				showSources={!campaignId}
				filters={{
					from: `${from}T00:00:00.000Z`,
					to: `${to}T23:59:59.999Z`,
					...(campaignId ? { campaign_id: campaignId } : {}),
				}}
			/>
			<Card>
				<CardHeader>
					<CardTitle>{t("Time series")}</CardTitle>
					<CardDescription>
						{statistics?.series.length || 0} {t("measured event buckets")}
					</CardDescription>
				</CardHeader>
				<CardContent className="max-h-96 overflow-auto">
					{statistics?.series.length ? (
						<FrontTable className="w-full text-sm">
							<FrontTableHeader>
								<FrontTableRow className="border-b text-start">
									<FrontTableHead className="p-2">{t("Period")}</FrontTableHead>
									<FrontTableHead className="p-2">{t("Event")}</FrontTableHead>
									<FrontTableHead className="p-2 text-end">{t("Total")}</FrontTableHead>
								</FrontTableRow>
							</FrontTableHeader>
							<FrontTableBody>
								{statistics.series.map((row, index) => (
									<FrontTableRow
										key={`${String(row.bucket)}:${String(row.event_type)}:${index}`}
										className="border-b"
									>
										<FrontTableCell className="p-2 font-mono text-xs">
											{typeof row.bucket === "string" || typeof row.bucket === "number"
												? row.bucket
												: "—"}
										</FrontTableCell>
										<FrontTableCell className="p-2">
											{t(
												metricLabel(
													typeof row.event_type === "string" && row.event_type
														? row.event_type
														: "unknown",
												),
											)}
										</FrontTableCell>
										<FrontTableCell className="p-2 text-end font-medium">
											{Number(row.total || 0).toLocaleString(locale)}
										</FrontTableCell>
									</FrontTableRow>
								))}
							</FrontTableBody>
						</FrontTable>
					) : (
						<Empty
							text={t(
								"No delivery events in this period yet. Send a campaign or activate an automation to see results here.",
							)}
						/>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

/** Campaign and journey jobs that need an operator: double opt-in outbox and terminal Queue jobs. */
export function MarketingOperations() {
	const { t, locale } = useStudioI18n();
	const { selectedProject } = useProjectSelection();
	const [outbox, setOutbox] = useState<DeliveryOutboxItem[]>([]);
	const [deadLetters, setDeadLetters] = useState<MarketingDeadLetter[]>([]);
	const [auditCount, setAuditCount] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const load = useCallback(() => {
		if (!selectedProject) return;
		return Promise.all([
			getDeliveryOutbox(selectedProject.id),
			getMarketingDeadLetters(selectedProject.id),
			getMarketingAudit(selectedProject.id),
		])
			.then(([outboxRows, deadLetterRows, auditRows]) => {
				setOutbox(outboxRows);
				setDeadLetters(deadLetterRows);
				setAuditCount(auditRows.length);
				setError(null);
			})
			.catch((cause: unknown) => {
				setError(moduleErrorMessage(cause, locale));
			});
	}, [selectedProject, locale]);
	useEffect(() => void load(), [load]);
	const run = async (action: () => Promise<unknown>, success: string) => {
		try {
			await action();
			showSuccessNotification(t(success));
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};
	if (!selectedProject) return <EmptyProject />;
	return (
		<section className="space-y-4">
			<h2 className="text-lg font-semibold">{t("Marketing delivery operations")}</h2>
			{error && <p role="alert">{error}</p>}
			<p>{t("{count} audited mutations", { count: auditCount })}</p>
			<div className="grid gap-6 xl:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>{t("Delivery outbox")}</CardTitle>
						<CardDescription>
							{t("Pending and dead-lettered double opt-in deliveries")}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2">
						{outbox.length === 0 ? (
							<Empty text={t("Delivery outbox is empty.")} />
						) : (
							outbox.map((item) => (
								<div
									key={item.id}
									className="flex items-center justify-between rounded-md border p-3"
								>
									<div>
										<p className="font-medium">{item.job_type}</p>
										<p className="text-xs text-muted-foreground">
											{t("{status} · {count} attempts", {
												status: item.status,
												count: item.attempt_count,
											})}{" "}
											{item.last_error ? `· ${item.last_error}` : ""}
										</p>
									</div>
									{["pending", "dead_letter"].includes(item.status) && (
										<Button
											size="sm"
											variant="outline"
											onClick={() =>
												void run(
													() => retryDeliveryOutbox(selectedProject.id, item.id),
													"Delivery retry queued",
												)
											}
										>
											<RotateCcw />
											{t("Retry")}
										</Button>
									)}
								</div>
							))
						)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>{t("Marketing dead letters")}</CardTitle>
						<CardDescription>
							{t("Inspect and resolve individual terminal Queue jobs")}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2">
						{deadLetters.length === 0 ? (
							<Empty text={t("No marketing dead letters.")} />
						) : (
							deadLetters.map((item) => (
								<div key={item.id} className="rounded-md border p-3">
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0">
											<p className="truncate font-medium">
												{item.job_type || t("Unknown Queue job")}
											</p>
											<p className="text-xs text-muted-foreground">
												{item.status}
												{item.resolution ? ` · ${item.resolution}` : ""} · {item.attempts}{" "}
												{t("attempts")}
											</p>
											<p className="truncate font-mono text-xs text-muted-foreground">
												{item.resource_id || item.queue_message_id}
											</p>
										</div>
										{item.status === "quarantined" && (
											<div className="flex shrink-0">
												<Button
													size="icon"
													variant="ghost"
													aria-label={t("Replay dead letter {name}", { name: item.id })}
													disabled={!item.replayable}
													title={t(
														item.replayable
															? "Replay"
															: "Payload was redacted and cannot be replayed",
													)}
													onClick={() =>
														void run(
															() => replayMarketingDeadLetter(selectedProject.id, item.id),
															"Marketing job queued again",
														)
													}
												>
													<RotateCcw />
												</Button>
												<Button
													size="icon"
													variant="ghost"
													aria-label={t("Discard dead letter {name}", { name: item.id })}
													onClick={() =>
														void run(
															() => discardMarketingDeadLetter(selectedProject.id, item.id),
															"Marketing dead letter discarded",
														)
													}
												>
													<Trash2 />
												</Button>
											</div>
										)}
									</div>
								</div>
							))
						)}
					</CardContent>
				</Card>
			</div>
		</section>
	);
}

function metricLabel(key: string) {
	const label = key.replaceAll("_", " ");
	return label.charAt(0).toUpperCase() + label.slice(1);
}

function Empty({ text }: { text: string }) {
	return <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>;
}
