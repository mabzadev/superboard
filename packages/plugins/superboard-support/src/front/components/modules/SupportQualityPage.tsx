"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@superboard/front-ui/ui/card.js";
import { RefreshCw, ShieldCheck, Star } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
	getSupportCsat,
	getSupportAudit,
	getSupportQuality,
	type SupportCsat,
	type SupportAuditEvent,
	type SupportQuality,
} from "../../api/messaging/operationsService.js";
import { useSupportI18n } from "../../i18n.js";
import { SupportModulePage as ModulePage } from "../support/SupportModulePage.js";

export function SupportQualityPage({
	inboxId,
	auditOnly = false,
}: { inboxId?: string; auditOnly?: boolean } = {}) {
	const { t, locale } = useSupportI18n();
	const { selectedProject } = useProjectSelection();
	const [quality, setQuality] = useState<SupportQuality | null>(null);
	const [responses, setResponses] = useState<SupportCsat[]>([]);
	const [audit, setAudit] = useState<SupportAuditEvent[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const load = useCallback(async () => {
		if (!selectedProject) return;
		setLoading(true);
		try {
			const [summary, csat, trail] = await Promise.all([
				auditOnly
					? Promise.resolve({ data: null })
					: getSupportQuality(selectedProject.id, inboxId),
				auditOnly ? Promise.resolve({ data: [] }) : getSupportCsat(selectedProject.id, inboxId),
				getSupportAudit(selectedProject.id, inboxId),
			]);
			setQuality(summary.data);
			setResponses(csat.data || []);
			setAudit(trail.data || []);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		} finally {
			setLoading(false);
		}
	}, [selectedProject, inboxId, auditOnly]);
	useEffect(() => void load(), [load]);

	return (
		<ModulePage
			title={t("Quality")}
			description={t("CSAT, response performance and the complete Support audit trail.")}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-6">
					<div className="flex justify-end">
						<Button variant="outline" disabled={loading} onClick={() => void load()}>
							<RefreshCw className={loading ? "animate-spin" : ""} />
							{t("Refresh")}
						</Button>
					</div>
					{!auditOnly && (
						<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
							<Metric
								label={t("Average CSAT")}
								value={
									quality?.csat.average_rating == null
										? "—"
										: `${Number(quality.csat.average_rating).toFixed(2)} / 5`
								}
							/>
							<Metric label={t("CSAT responses")} value={String(quality?.csat.responses ?? 0)} />
							<Metric
								label={t("Open conversations")}
								value={String(quality?.conversations.open ?? 0)}
							/>
							<Metric
								label={t("First reply")}
								value={minutes(quality?.response_times.average_first_reply_minutes)}
							/>
							<Metric
								label={t("Resolution")}
								value={minutes(quality?.response_times.average_resolution_minutes)}
							/>
						</div>
					)}
					<div className={auditOnly ? "space-y-4" : "grid gap-6 xl:grid-cols-2"}>
						{!auditOnly && (
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2">
										<Star />
										{t("Customer satisfaction")}
									</CardTitle>
									<CardDescription>{t("Latest ratings and customer feedback")}</CardDescription>
								</CardHeader>
								<CardContent className="space-y-2">
									{responses.length === 0 ? (
										<Empty text={t("No CSAT responses yet.")} />
									) : (
										responses.map((item) => (
											<div key={item.id} className="rounded-md border p-3">
												<div className="flex justify-between gap-3">
													<p className="font-medium">{item.subject || item.conversation_id}</p>
													<span className="rounded-full bg-muted px-2 py-1 text-xs">
														{item.rating}/5
													</span>
												</div>
												<p className="mt-1 text-sm text-muted-foreground">
													{item.feedback || t("No written feedback")}
												</p>
												<p className="mt-2 text-xs text-muted-foreground">
													{new Date(item.created_at).toLocaleString(locale)}
												</p>
											</div>
										))
									)}
								</CardContent>
							</Card>
						)}
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<ShieldCheck />
									{t("Audit trail")}
								</CardTitle>
								<CardDescription>
									{t("Every Support configuration and conversation mutation")}
								</CardDescription>
							</CardHeader>
							<CardContent className="max-h-[560px] space-y-2 overflow-auto">
								{audit.length === 0 ? (
									<Empty text={t("No audit events yet.")} />
								) : (
									audit.map((event) => (
										<div key={event.id} className="rounded-md border p-3">
											<div className="flex justify-between gap-3">
												<p className="font-medium">{event.action}</p>
												<span className="text-xs text-muted-foreground">{event.source}</span>
											</div>
											<p className="text-xs text-muted-foreground">
												{event.actor_kind}:{event.actor_id} ·{" "}
												{new Date(event.created_at).toLocaleString(locale)}
											</p>
										</div>
									))
								)}
							</CardContent>
						</Card>
					</div>
				</div>
			)}
		</ModulePage>
	);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<Card>
			<CardHeader>
				<CardDescription>{label}</CardDescription>
				<CardTitle>{value}</CardTitle>
			</CardHeader>
		</Card>
	);
}
function Empty({ text }: { text: string }) {
	return <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>;
}
function minutes(value?: number | null) {
	return value == null ? "—" : `${Number(value).toFixed(1)} min`;
}
