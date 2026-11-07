"use client";

import DeleteConfirm from "@superboard/front-ui/common/delete-confirm.js";
import { Button } from "@superboard/front-ui/kumo";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import { SettingsActions, SettingsRow, SettingsSection } from "@superboard/front-ui/settings-form";
import { Alert, AlertDescription, AlertTitle } from "@superboard/front-ui/ui/alert.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
	getPlatformAccountErasures,
	getPlatformCustomJobs,
	getPlatformEmailOperations,
	getPlatformStatus,
	discardPlatformEmailDeadLetter,
	replayPlatformEmailDeadLetter,
	retryPlatformCustomJob,
	type PlatformAccountErasure,
	type PlatformCustomJob,
	type PlatformEmailOperations,
	type PlatformStatus,
	type RuntimeMetricRow,
} from "../../../api/platform/platformService.js";
import DeploymentConfiguration from "../../../DeploymentConfiguration.js";
import { useObservabilityI18n, type ObservabilityI18n } from "../../../i18n.js";
import IncidentsPanel, { useObservations, WorkerObservations } from "../../../IncidentsPanel.js";
import { WorkerDeploymentGroups } from "../../../WorkerDeploymentGroups.js";

const cell = "py-2 pe-4 text-start align-top";
const head = "py-2 pe-4 text-start font-medium";

export default function InfrastructurePage() {
	const i18n = useObservabilityI18n();
	const { t } = i18n;
	const observations = useObservations();
	const [status, setStatus] = useState<PlatformStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [customJobs, setCustomJobs] = useState<PlatformCustomJob[]>([]);
	const [accountErasures, setAccountErasures] = useState<PlatformAccountErasure[]>([]);
	const [emailOperations, setEmailOperations] = useState<PlatformEmailOperations | null>(null);
	const [emailOperationsError, setEmailOperationsError] = useState<string | null>(null);
	const [retryingJob, setRetryingJob] = useState<string | null>(null);
	const [resolvingDeadLetter, setResolvingDeadLetter] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshes, setRefreshes] = useState(0);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const next = await getPlatformStatus();
			setStatus(next);
			const supportsJobInspection = next.custom.status === "ok" && next.custom.manifest != null;
			const emailEnabled = next.services.some(
				(service) => service.id === "email" && service.status !== "disabled",
			);
			const [nextCustomJobs, nextAccountErasures, nextEmailOperations] = await Promise.all([
				supportsJobInspection
					? getPlatformCustomJobs().then((page) => page.jobs)
					: Promise.resolve([]),
				getPlatformAccountErasures(),
				emailEnabled
					? getPlatformEmailOperations()
							.then((data) => ({ data, error: null }))
							.catch((reason: unknown) => ({
								data: null,
								error:
									reason instanceof Error ? reason.message : "Email operations are unavailable.",
							}))
					: Promise.resolve({ data: null, error: null }),
			]);
			setCustomJobs(nextCustomJobs);
			setAccountErasures(nextAccountErasures);
			setEmailOperations(nextEmailOperations.data);
			setEmailOperationsError(nextEmailOperations.error);
			setError(null);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Unable to load the service status.");
		} finally {
			setLoading(false);
		}
	}, []);

	const resolveDeadLetter = useCallback(
		async (deadLetterId: string, decision: "replay" | "discard") => {
			setResolvingDeadLetter(deadLetterId);
			try {
				if (decision === "replay") {
					await replayPlatformEmailDeadLetter(deadLetterId);
				} else {
					await discardPlatformEmailDeadLetter(deadLetterId);
				}
				setEmailOperations(await getPlatformEmailOperations());
				setEmailOperationsError(null);
			} catch (reason) {
				setEmailOperationsError(
					reason instanceof Error ? reason.message : "Unable to resolve this quarantined email.",
				);
			} finally {
				setResolvingDeadLetter(null);
			}
		},
		[],
	);

	const retryJob = useCallback(async (jobId: string) => {
		setRetryingJob(jobId);
		try {
			await retryPlatformCustomJob(jobId);
			const next = await getPlatformCustomJobs();
			setCustomJobs(next.jobs);
			setError(null);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Unable to retry this job.");
		} finally {
			setRetryingJob(null);
		}
	}, []);

	useEffect(() => {
		void load();
		const refresh = () => {
			if (document.visibilityState !== "hidden") load().catch(() => undefined);
		};
		const timer = window.setInterval(refresh, 30_000);
		document.addEventListener("visibilitychange", refresh);
		return () => {
			window.clearInterval(timer);
			document.removeEventListener("visibilitychange", refresh);
		};
	}, [load]);

	const windowLabel = i18n.window(status?.runtime?.windowMinutes ?? 60);

	return (
		<div className="ds-page space-y-5">
			<header className="ds-page-header">
				<div>
					<h1 className="ds-page-title">{t("Service health")}</h1>
					<p className="ds-page-description">
						{t(
							"Live status of the SuperBoard API, Workers, data stores, users and background jobs.",
						)}
					</p>
				</div>
			</header>
			<SectionNavigation />
			<div className="flex w-full flex-col gap-8">
				{error && (
					<Alert variant="destructive">
						<AlertTitle>{t("Status unavailable")}</AlertTitle>
						<AlertDescription>{i18n.message(error)}</AlertDescription>
					</Alert>
				)}

				{status?.catalog && status.catalog.status !== "ok" && (
					<Alert variant="destructive">
						<AlertTitle>{t("Worker catalog misconfigured")}</AlertTitle>
						<AlertDescription>
							{status.catalog.error ?? t("The target Worker inventory is unavailable.")}
						</AlertDescription>
					</Alert>
				)}

				{status && (
					<SettingsSection
						title={t("Overview")}
						description={t("Overall platform status and recent activity.")}
					>
						<ValueRow
							label={t("Platform")}
							value={<StatusBadge i18n={i18n} value={status.status} />}
						/>
						<ValueRow label={t("Users")} value={i18n.number(status.metrics.users)} />
						<ValueRow label={t("Projects")} value={i18n.number(status.metrics.projects)} />
						<ValueRow
							label={t("Invocations ({window})", { window: windowLabel })}
							value={i18n.number(
								status.runtime?.error ? null : totalInvocations(status.runtime?.rows),
							)}
						/>
					</SettingsSection>
				)}

				<IncidentsPanel observations={observations} />

				{status && (
					<>
						<SettingsSection
							title={t("Public availability")}
							description={t(
								"DNS and HTTPS checks of the public addresses, separate from the internal Worker health.",
							)}
						>
							{(status.publicSurfaces ?? []).length === 0 && (
								<EmptyRow>{t("No public address is monitored.")}</EmptyRow>
							)}
							{(status.publicSurfaces ?? []).map((surface) => (
								<SettingsRow key={surface.id}>
									<ItemHeader
										title={i18n.name(surface.id)}
										badge={<StatusBadge i18n={i18n} value={surface.status} />}
									/>
									<p className="text-sm text-kumo-subtle">{surface.description}</p>
									<div className="flex flex-wrap items-center gap-3 text-xs text-kumo-subtle">
										<span>
											HTTP {surface.httpStatus ?? "—"} ·{" "}
											{surface.responseTimeMs == null
												? t("No response")
												: i18n.duration(surface.responseTimeMs)}
										</span>
										{surface.url && (
											<a
												className="inline-flex items-center gap-1 text-kumo-brand underline"
												href={surface.url}
												target="_blank"
												rel="noreferrer"
											>
												{t("Visit")}
											</a>
										)}
									</div>
									{surface.error && <p className="text-xs text-kumo-danger">{surface.error}</p>}
								</SettingsRow>
							))}
						</SettingsSection>

						<SettingsSection
							title={t("Data stores")}
							description={t(
								"Owner and live availability of each data store. Raw SQL is never exposed here.",
							)}
						>
							{status.dataStores.map((store) => (
								<SettingsRow key={store.id}>
									<ItemHeader
										title={store.id}
										subtitle={`${store.kind} · ${store.owner}`}
										badge={<StatusBadge i18n={i18n} value={store.status} />}
									/>
									<p className="text-sm text-kumo-subtle">{store.description}</p>
									{store.kind === "D1" && (
										<div className="space-y-1 border-t border-kumo-line pt-3 text-xs text-kumo-subtle">
											<div className="flex items-center justify-between gap-3">
												<span>{t("Schema")}</span>
												<StatusBadge i18n={i18n} value={store.schema?.status ?? "unavailable"} />
											</div>
											{store.schema && (
												<>
													<p>
														{t("Expected migration: {name}", {
															name: store.schema.expectedMigration,
														})}
													</p>
													<p>
														{t("Applied migration: {name} · {count} in total", {
															name: store.schema.latestMigration ?? t("None"),
															count: i18n.number(store.schema.appliedMigrationCount),
														})}
													</p>
												</>
											)}
										</div>
									)}
								</SettingsRow>
							))}
						</SettingsSection>

						<SettingsSection
							title={t("Inventory")}
							description={t("Current record counts in the API database.")}
						>
							{Object.entries(status.metrics).map(([name, value]) => (
								<ValueRow key={name} label={i18n.name(name)} value={i18n.number(value)} />
							))}
						</SettingsSection>

						<SettingsSection
							title={t("Background jobs")}
							description={t(
								"Persisted job state; the Cloudflare Queue backlog stays available in Cloudflare analytics.",
							)}
						>
							{Object.entries(status.jobs).map(([name, values]) => (
								<ValueRow
									key={name}
									label={i18n.name(name)}
									value={
										values
											? Object.entries(values)
													.map(([key, value]) =>
														t("{name}: {value}", {
															name: i18n.name(key),
															value: i18n.number(value),
														}),
													)
													.join(" · ") || i18n.number(0)
											: t("Unavailable")
									}
								/>
							))}
						</SettingsSection>

						<SettingsSection
							title={t("Email delivery")}
							description={t(
								"Transactional, marketing and test emails handled by the Email Worker, without their content.",
							)}
						>
							{emailOperationsError && (
								<SettingsRow>
									<p className="text-sm text-kumo-danger" role="alert">
										{i18n.message(emailOperationsError)}
									</p>
								</SettingsRow>
							)}
							{emailOperations?.queue && (
								<>
									<ValueRow
										label={t("Queue backlog")}
										value={i18n.number(emailOperations.queue.backlogCount)}
									/>
									<ValueRow
										label={t("Backlog size")}
										value={i18n.bytes(emailOperations.queue.backlogBytes)}
									/>
									<ValueRow
										label={t("Oldest queued message")}
										value={i18n.date(emailOperations.queue.oldestMessageAt)}
									/>
								</>
							)}
							{emailOperations && !emailOperations.queue && (
								<EmptyRow>
									{t("Cloudflare Queue metrics are unavailable for this target.")}
								</EmptyRow>
							)}
							{!emailOperations ? (
								<EmptyRow>{t("Email operations are disabled or unavailable.")}</EmptyRow>
							) : emailOperations.messages.length === 0 ? (
								<EmptyRow>{t("No email has been recorded.")}</EmptyRow>
							) : (
								<SettingsRow>
									<div className="overflow-x-auto">
										<table className="w-full text-sm">
											<thead className="border-b border-kumo-line text-xs text-kumo-subtle">
												<tr>
													<th className={head}>{t("Message")}</th>
													<th className={head}>{t("Kind")}</th>
													<th className={head}>{t("Status")}</th>
													<th className={head}>{t("Recipients")}</th>
													<th className={head}>{t("Attempts")}</th>
													<th className={head}>{t("Last error")}</th>
													<th className={head}>{t("Updated")}</th>
												</tr>
											</thead>
											<tbody>
												{emailOperations.messages.map((message) => (
													<tr key={message.id} className="border-b border-kumo-line last:border-0">
														<td className={`${cell} max-w-48`}>
															<p className="truncate" title={message.subject}>
																{message.subject}
															</p>
															<p className="truncate font-mono text-xs text-kumo-subtle">
																{message.id}
															</p>
														</td>
														<td className={cell}>{i18n.name(message.kind)}</td>
														<td className={cell}>
															<StatusBadge i18n={i18n} value={message.status} />
														</td>
														<td className={cell}>
															{i18n.number(message.recipientCount)}
															{message.failedRecipients > 0
																? ` · ${t("{count} failed", { count: i18n.number(message.failedRecipients) })}`
																: ""}
														</td>
														<td className={cell}>{i18n.number(message.attempts)}</td>
														<td
															className={`${cell} max-w-56 truncate text-xs text-kumo-danger`}
															title={message.lastError ?? undefined}
														>
															{message.lastError ?? "—"}
														</td>
														<td className={cell}>{i18n.date(message.updatedAt)}</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</SettingsRow>
							)}
						</SettingsSection>

						{emailOperations && (
							<SettingsSection
								title={t("Delegated SMTP transport")}
								description={t(
									"Project SMTP deliveries sent by the Email Worker; unknown outcomes are never retried automatically.",
								)}
							>
								{(emailOperations.transportDeliveries ?? []).length === 0 ? (
									<EmptyRow>{t("No delegated SMTP delivery has been recorded.")}</EmptyRow>
								) : (
									(emailOperations.transportDeliveries ?? []).map((delivery) => (
										<SettingsRow key={delivery.id}>
											<ItemHeader
												title={<span className="font-mono">{delivery.referenceId}</span>}
												subtitle={t(
													"{source} · project {project} · profile {profile} · {attempts} attempts",
													{
														source: delivery.source,
														project: delivery.projectId,
														profile: delivery.profileId,
														attempts: i18n.number(delivery.attempts),
													},
												)}
												badge={<StatusBadge i18n={i18n} value={delivery.status} />}
											/>
											<p className="text-xs text-kumo-subtle">{i18n.date(delivery.updatedAt)}</p>
											{delivery.lastError && (
												<p className="text-xs text-kumo-danger">{delivery.lastError}</p>
											)}
										</SettingsRow>
									))
								)}
							</SettingsSection>
						)}

						<SettingsSection
							title={t("Email quarantine")}
							description={t(
								"Emails that failed for good. Only those kept without secret redaction can be sent again.",
							)}
						>
							{!emailOperations ? (
								<EmptyRow>{t("Email quarantine is disabled or unavailable.")}</EmptyRow>
							) : emailOperations.deadLetters.length === 0 ? (
								<EmptyRow>{t("Email quarantine is empty.")}</EmptyRow>
							) : (
								emailOperations.deadLetters.map((deadLetter) => (
									<SettingsRow key={deadLetter.id}>
										<ItemHeader
											title={
												<span className="font-mono text-xs">
													{deadLetter.emailMessageId ?? deadLetter.id}
												</span>
											}
											subtitle={t("{job} · {attempts} attempts · {queue}", {
												job: deadLetter.jobType ?? t("Unknown job"),
												attempts: i18n.number(deadLetter.attempts),
												queue: deadLetter.sourceQueue,
											})}
											badge={
												<StatusBadge
													i18n={i18n}
													value={deadLetter.resolution ?? deadLetter.status}
												/>
											}
										/>
										<p className="text-xs text-kumo-subtle">
											{i18n.date(deadLetter.resolvedAt ?? deadLetter.receivedAt)}
										</p>
										{deadLetter.status === "quarantined" && (
											<SettingsActions>
												<Button
													size="sm"
													aria-label={t("Replay email dead letter {id}", { id: deadLetter.id })}
													disabled={!deadLetter.replayable || resolvingDeadLetter === deadLetter.id}
													onClick={() => void resolveDeadLetter(deadLetter.id, "replay")}
												>
													{t("Replay")}
												</Button>
												<DeleteConfirm
													title={t("Discard this email?")}
													description={t(
														"The email leaves the quarantine and will never be sent. This cannot be undone.",
													)}
													confirmText={t("Discard")}
													onConfirm={() => resolveDeadLetter(deadLetter.id, "discard")}
												>
													<Button
														size="sm"
														variant="secondary-destructive"
														aria-label={t("Discard email dead letter {id}", { id: deadLetter.id })}
														disabled={resolvingDeadLetter === deadLetter.id}
													>
														{t("Discard")}
													</Button>
												</DeleteConfirm>
											</SettingsActions>
										)}
									</SettingsRow>
								))
							)}
						</SettingsSection>

						<SettingsSection
							title={t("Account deletions")}
							description={t(
								"Progress of account deletions across services; people are pseudonymized.",
							)}
						>
							{accountErasures.length === 0 ? (
								<EmptyRow>{t("No account deletion has been recorded.")}</EmptyRow>
							) : (
								<SettingsRow>
									<div className="overflow-x-auto">
										<table className="w-full text-sm">
											<thead className="border-b border-kumo-line text-xs text-kumo-subtle">
												<tr>
													<th className={head}>{t("Operation")}</th>
													<th className={head}>{t("Project")}</th>
													<th className={head}>{t("Subject reference")}</th>
													<th className={head}>{t("Status")}</th>
													<th className={head}>{t("Completed steps")}</th>
													<th className={head}>{t("Attempts")}</th>
													<th className={head}>{t("Last error")}</th>
													<th className={head}>{t("Updated")}</th>
												</tr>
											</thead>
											<tbody>
												{accountErasures.map((operation) => (
													<tr
														key={operation.id}
														className="border-b border-kumo-line last:border-0"
													>
														<td
															className={`${cell} max-w-36 truncate font-mono text-xs`}
															title={operation.id}
														>
															{operation.id}
														</td>
														<td className={cell}>{operation.projectRef}</td>
														<td className={`${cell} font-mono text-xs`}>
															{operation.subjectReference}
														</td>
														<td className={cell}>
															<StatusBadge i18n={i18n} value={operation.status} />
														</td>
														<td className={cell}>{operation.completedSteps.join(" → ") || "—"}</td>
														<td className={cell}>{i18n.number(operation.attempts)}</td>
														<td className={cell}>
															{operation.lastErrorService && operation.lastErrorCode
																? `${operation.lastErrorService}: ${operation.lastErrorCode}`
																: "—"}
														</td>
														<td className={cell}>{i18n.date(operation.updatedAt)}</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</SettingsRow>
							)}
						</SettingsSection>

						{status.custom.status !== "disabled" && (
							<SettingsSection
								title={t("Application services")}
								description={t("Services specific to this application, run by its own Worker.")}
							>
								<SettingsRow>
									<ItemHeader
										title={status.custom.manifest?.description ?? t("Custom Worker unavailable")}
										badge={<StatusBadge i18n={i18n} value={status.custom.status} />}
									/>
									{status.custom.error && (
										<p className="text-sm text-kumo-danger" role="alert">
											{status.custom.error}
										</p>
									)}
								</SettingsRow>
								{status.custom.manifest?.capabilities.map((capability) => (
									<SettingsRow key={capability.id}>
										<ItemHeader
											title={capability.id}
											badge={<Badge variant="outline">{i18n.name(capability.mode)}</Badge>}
										/>
										<p className="text-xs text-kumo-subtle">{capability.description}</p>
									</SettingsRow>
								))}
								{status.custom.stats && (
									<>
										<ValueRow
											label={t("Application users")}
											value={i18n.number(status.custom.stats.users?.total)}
										/>
										<ValueRow
											label={t("Premium users")}
											value={i18n.number(status.custom.stats.users?.premium)}
										/>
										<ValueRow
											label={t("Application jobs")}
											value={i18n.number(
												Object.values(status.custom.stats.jobs).reduce(
													(sum, value) => sum + value,
													0,
												),
											)}
										/>
										{status.custom.stats.cancellations && (
											<>
												<ValueRow
													label={t("Cancelled jobs")}
													value={i18n.number(status.custom.stats.cancellations.jobs)}
												/>
												<ValueRow
													label={t("Refunds pending")}
													value={i18n.number(status.custom.stats.cancellations.refundsPending)}
												/>
												<ValueRow
													label={t("Refunds applied")}
													value={i18n.number(status.custom.stats.cancellations.refundsApplied)}
												/>
												<ValueRow
													label={t("Credits refunded")}
													value={i18n.number(status.custom.stats.cancellations.creditsRefunded)}
												/>
											</>
										)}
									</>
								)}
								{customJobs.length > 0 ? (
									<SettingsRow>
										<div className="overflow-x-auto">
											<table className="w-full text-sm">
												<thead className="border-b border-kumo-line text-xs text-kumo-subtle">
													<tr>
														<th className={head}>{t("Job")}</th>
														<th className={head}>{t("Capability")}</th>
														<th className={head}>{t("Status")}</th>
														<th className={head}>{t("Progress")}</th>
														<th className={head}>{t("Attempts")}</th>
														<th className={head}>{t("Result")}</th>
														<th className={head}>{t("Updated")}</th>
														<th className={head}>{t("Action")}</th>
													</tr>
												</thead>
												<tbody>
													{customJobs.map((job) => (
														<tr key={job.id} className="border-b border-kumo-line last:border-0">
															<td
																className={`${cell} max-w-36 truncate font-mono text-xs`}
																title={job.id}
															>
																{job.id}
															</td>
															<td className={cell}>{job.capability}</td>
															<td className={cell}>
																<StatusBadge i18n={i18n} value={job.status} />
															</td>
															<td className={cell}>
																{job.progress == null ? "—" : `${Math.round(job.progress * 100)} %`}
															</td>
															<td className={cell}>{i18n.number(job.attempts ?? 0)}</td>
															<td className={cell}>{customJobResult(i18n, job)}</td>
															<td className={cell}>{i18n.date(job.updatedAt)}</td>
															<td className={cell}>
																{["failed", "queued"].includes(job.status) ? (
																	<Button
																		size="sm"
																		disabled={retryingJob === job.id}
																		onClick={() => void retryJob(job.id)}
																	>
																		{retryingJob === job.id ? t("Retrying…") : t("Retry")}
																	</Button>
																) : (
																	"—"
																)}
															</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
									</SettingsRow>
								) : (
									<EmptyRow>{t("No application job has been recorded.")}</EmptyRow>
								)}
							</SettingsSection>
						)}
					</>
				)}

				<section
					aria-labelledby="infrastructure-advanced"
					className="space-y-8 border-t border-kumo-line pt-8"
				>
					<div className="space-y-1">
						<h2 id="infrastructure-advanced" className="text-lg font-semibold">
							{t("Advanced")}
						</h2>
						<p className="text-sm text-kumo-subtle">
							{t(
								"Technical details for operators: deployment, addresses, API, Workers, runtime metrics and running configuration.",
							)}
						</p>
					</div>
					{status && (
						<>
							<SettingsSection
								title={t("Deployment")}
								description={t("Target, environment and release currently served.")}
							>
								<ValueRow label={t("Target")} value={status.deployment.target} />
								<ValueRow label={t("Environment")} value={status.environment} />
								<ValueRow label={t("Release")} value={status.deployment.release} />
								<ValueRow
									label={t("Public routing")}
									value={<StatusBadge i18n={i18n} value={status.deployment.publicRouting} />}
								/>
								<ValueRow label={t("Generated at")} value={i18n.date(status.generatedAt)} />
							</SettingsSection>

							<SettingsSection
								title={t("Integration addresses")}
								description={t("Public addresses generated from the active target manifest.")}
							>
								{Object.entries(status.endpoints).map(([name, url]) => (
									<ValueRow
										key={name}
										label={i18n.name(name)}
										value={
											url ? (
												<a
													className="inline-flex items-center gap-1 break-all text-kumo-brand underline"
													href={url}
													target="_blank"
													rel="noreferrer"
												>
													{url}
												</a>
											) : (
												<StatusBadge i18n={i18n} value="disabled" />
											)
										}
									/>
								))}
							</SettingsSection>

							<SettingsSection
								title={t("API capabilities")}
								description={t("What the SuperBoard API exposes and who can call it.")}
							>
								<SettingsRow>
									<ItemHeader
										title={status.api.description}
										badge={<StatusBadge i18n={i18n} value={status.api.status} />}
									/>
								</SettingsRow>
								{status.api.capabilities.map((capability) => (
									<SettingsRow key={capability.id}>
										<p className="text-sm font-medium">{capability.id}</p>
										<p className="text-sm text-kumo-subtle">{capability.description}</p>
										<p className="text-xs text-kumo-subtle">
											{t("Access: {access}", { access: capability.access })}
										</p>
										<div className="flex flex-wrap gap-1.5">
											{capability.entrypoints.map((entrypoint) => (
												<code
													key={entrypoint}
													className="rounded bg-kumo-tint px-1.5 py-0.5 text-xs"
												>
													{entrypoint}
												</code>
											))}
										</div>
									</SettingsRow>
								))}
							</SettingsSection>

							<SettingsSection
								title={t("Workers")}
								description={t(
									"Deployment name, role, health, dependencies and persisted jobs of each Worker.",
								)}
							>
								<SettingsRow>
									<WorkerDeploymentGroups services={status.services}>
										{(service) => (
											<div
												key={service.id}
												className="space-y-2 rounded-md border border-kumo-line p-4"
											>
												<ItemHeader
													title={service.id}
													subtitle={
														<span className="font-mono">
															{service.workerName ?? t("No deployment name")} ·{" "}
															{service.kind ?? t("legacy")}
														</span>
													}
													badge={<StatusBadge i18n={i18n} value={service.status} />}
												/>
												<p className="text-sm text-kumo-subtle">{service.description}</p>
												<p className="text-xs text-kumo-subtle">
													{t("Health check: {mode} {path} · {time}", {
														mode: service.health?.mode ?? t("legacy"),
														path: service.health?.path ?? t("unknown"),
														time:
															service.responseTimeMs == null
																? t("No response")
																: i18n.duration(service.responseTimeMs),
													})}
												</p>
												<WorkerValues
													label={t("Capabilities")}
													values={service.capabilities ?? []}
												/>
												<WorkerValues label={t("Routes")} values={service.routes ?? []} code />
												<WorkerValues
													label={t("Services")}
													values={service.dependencies?.services ?? []}
												/>
												<WorkerValues
													label={t("Stores")}
													values={service.dependencies?.stores ?? []}
												/>
												<WorkerValues
													label={t("Queues")}
													values={service.dependencies?.queues ?? []}
												/>
												{(service.dependencies?.externalWorkers ?? []).map((dependency) => (
													<p key={dependency.binding} className="text-xs text-kumo-subtle">
														{t("External: {binding} → {worker}", {
															binding: dependency.binding,
															worker: dependency.workerName,
														})}
													</p>
												))}
												<p className="text-xs text-kumo-subtle">
													{t("Jobs: {jobs}", {
														jobs:
															service.jobs == null
																? t("Unavailable")
																: Object.entries(service.jobs)
																		.map(([name, value]) =>
																			t("{name}: {value}", {
																				name: i18n.name(name),
																				value: i18n.number(value),
																			}),
																		)
																		.join(" · ") || t("None"),
													})}
												</p>
												{service.error && (
													<p className="text-xs text-kumo-danger">{service.error}</p>
												)}
												{runtimeFor(i18n, status.runtime?.rows, service.id) && (
													<p className="text-xs text-kumo-subtle">
														{runtimeFor(i18n, status.runtime?.rows, service.id)}
													</p>
												)}
												{service.detail != null && (
													<details className="text-xs">
														<summary className="cursor-pointer text-kumo-subtle">
															{t("Runtime detail")}
														</summary>
														<pre className="mt-2 max-h-48 overflow-auto rounded bg-kumo-tint p-2">
															{JSON.stringify(service.detail, null, 2)}
														</pre>
													</details>
												)}
											</div>
										)}
									</WorkerDeploymentGroups>
								</SettingsRow>
							</SettingsSection>

							<SettingsSection
								title={t("Cloudflare runtime")}
								description={t("Tail Worker and Analytics Engine metrics over the last {window}.", {
									window: windowLabel,
								})}
							>
								{!status.runtime && <EmptyRow>{t("Observability binding is disabled.")}</EmptyRow>}
								{status.runtime?.error && (
									<SettingsRow>
										<Alert variant="destructive">
											<AlertTitle>{t("Runtime metrics unavailable")}</AlertTitle>
											<AlertDescription>{status.runtime.error}</AlertDescription>
										</Alert>
									</SettingsRow>
								)}
								{status.runtime?.rows.length === 0 && !status.runtime.error && (
									<EmptyRow>{t("No invocation has been recorded in this window.")}</EmptyRow>
								)}
								{status.runtime && status.runtime.rows.length > 0 && (
									<SettingsRow>
										<div className="overflow-x-auto">
											<table className="w-full text-sm">
												<thead className="border-b border-kumo-line text-xs text-kumo-subtle">
													<tr>
														<th className={head}>{t("Worker")}</th>
														<th className={head}>{t("Event")}</th>
														<th className={head}>{t("Outcome")}</th>
														<th className={head}>{t("Invocations")}</th>
														<th className={head}>{t("Exceptions")}</th>
														<th className={head}>{t("Average CPU")}</th>
														<th className={head}>{t("Average duration")}</th>
														<th className={head}>{t("Maximum duration")}</th>
													</tr>
												</thead>
												<tbody>
													{status.runtime.rows.map((row) => {
														const outcome = i18n.outcome(row.outcome);
														return (
															<tr
																key={`${row.service}:${row.eventType}:${row.outcome}`}
																className="border-b border-kumo-line last:border-0"
															>
																<td className={`${cell} font-medium`}>{row.service}</td>
																<td className={cell}>{row.eventType}</td>
																<td className={cell}>
																	<Badge variant={outcome.variant}>{outcome.label}</Badge>
																</td>
																<td className={cell}>{i18n.number(row.invocations)}</td>
																<td className={cell}>{i18n.number(row.exceptions)}</td>
																<td className={cell}>{i18n.duration(row.averageCpuMs)}</td>
																<td className={cell}>{i18n.duration(row.averageWallMs)}</td>
																<td className={cell}>{i18n.duration(row.maximumWallMs)}</td>
															</tr>
														);
													})}
												</tbody>
											</table>
										</div>
									</SettingsRow>
								)}
							</SettingsSection>
						</>
					)}
					<WorkerObservations observations={observations} />
					<DeploymentConfiguration refreshKey={refreshes} />
				</section>

				<SettingsActions className="items-center">
					{status && (
						<p className="text-xs text-kumo-subtle">
							{t("Updated {date}", { date: i18n.date(status.generatedAt) })}
						</p>
					)}
					<Button
						onClick={() => {
							setRefreshes((count) => count + 1);
							load().catch(() => undefined);
						}}
						disabled={loading}
					>
						{t("Refresh")}
					</Button>
				</SettingsActions>
			</div>
		</div>
	);
}

function customJobResult(i18n: ObservabilityI18n, job: PlatformCustomJob): string {
	if (job.capability !== "reference.acceptance") return "—";
	const acceptance = job.result?.acceptance;
	if (!acceptance || typeof acceptance !== "object" || Array.isArray(acceptance)) {
		return i18n.t("Invalid acceptance receipt");
	}
	const value = acceptance as Record<string, unknown>;
	return i18n.t("{decision} · platform {platform} · reference {reference}", {
		decision: typeof value.decision === "string" ? value.decision : i18n.t("unknown"),
		platform: shortRevision(i18n, value.platformRevision),
		reference: shortRevision(i18n, value.referenceRevision),
	});
}

function shortRevision(i18n: ObservabilityI18n, value: unknown): string {
	return typeof value === "string" && /^[0-9a-f]{40}$/.test(value)
		? value.slice(0, 12)
		: i18n.t("unproven");
}

function ValueRow({ label, value }: { label: ReactNode; value: ReactNode }) {
	return (
		<SettingsRow className="flex items-center justify-between gap-4">
			<span className="text-sm">{label}</span>
			<span className="min-w-0 text-end text-sm font-medium">{value}</span>
		</SettingsRow>
	);
}

function EmptyRow({ children }: { children: ReactNode }) {
	return (
		<SettingsRow>
			<p className="text-sm text-kumo-subtle">{children}</p>
		</SettingsRow>
	);
}

function ItemHeader({
	title,
	subtitle,
	badge,
}: {
	title: ReactNode;
	subtitle?: ReactNode;
	badge: ReactNode;
}) {
	return (
		<div className="flex items-start justify-between gap-3">
			<div className="min-w-0 space-y-0.5">
				<p className="text-sm font-medium">{title}</p>
				{subtitle && <p className="text-xs text-kumo-subtle">{subtitle}</p>}
			</div>
			{badge}
		</div>
	);
}

function WorkerValues({
	label,
	values,
	code = false,
}: {
	label: string;
	values: string[];
	code?: boolean;
}) {
	if (values.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-1 text-xs text-kumo-subtle">
			<span>{label}</span>
			{values.map((value) =>
				code ? (
					<code key={value} className="rounded bg-kumo-tint px-1 py-0.5">
						{value}
					</code>
				) : (
					<span key={value} className="rounded border border-kumo-line px-1 py-0.5">
						{value}
					</span>
				),
			)}
		</div>
	);
}

function StatusBadge({ i18n, value }: { i18n: ObservabilityI18n; value: string }) {
	const status = i18n.status(value);
	return <Badge variant={status.variant}>{status.label}</Badge>;
}

function totalInvocations(rows: RuntimeMetricRow[] | undefined) {
	return rows?.reduce((total, row) => total + row.invocations, 0) ?? null;
}

function runtimeFor(
	i18n: ObservabilityI18n,
	rows: RuntimeMetricRow[] | undefined,
	serviceId: string,
): string | null {
	const matching =
		rows?.filter((row) => row.service === serviceId || row.service.includes(serviceId)) ?? [];
	if (matching.length === 0) return null;
	return i18n.t("{invocations} invocations · {exceptions} exceptions", {
		invocations: i18n.number(matching.reduce((total, row) => total + row.invocations, 0)),
		exceptions: i18n.number(matching.reduce((total, row) => total + row.exceptions, 0)),
	});
}
