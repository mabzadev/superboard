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
import { RotateCcw, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
	discardEmailDeadLetter,
	getDeliveryOutbox,
	getProviderEvents,
	getEmailDeadLetters,
	getSmtpSettings,
	replayEmailDeadLetter,
	retryDeliveryOutbox,
	testSmtpSettings,
	type DeliveryOutboxItem,
	type EmailDeadLetter,
	type SmtpSettings,
} from "../../api/email/emailService.js";
import { useEmailI18n } from "./email-i18n.js";
import { SenderIdentities } from "./SenderIdentities.js";

export function EmailAdministration({
	section = "operations",
}: {
	section?: "delivery" | "operations";
}) {
	return section === "delivery" ? <SenderIdentities /> : <EmailDeliveryOperations />;
}

function EmailDeliveryOperations() {
	const { t } = useEmailI18n();
	const { selectedProject } = useProjectSelection();
	const [profiles, setProfiles] = useState<SmtpSettings[]>([]);
	const [outbox, setOutbox] = useState<DeliveryOutboxItem[]>([]);
	const [deadLetters, setDeadLetters] = useState<EmailDeadLetter[]>([]);
	const [eventCount, setEventCount] = useState(0);
	const [testRecipient, setTestRecipient] = useState("");
	const [error, setError] = useState<string | null>(null);
	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const [smtpResult, outboxRows, deadLetterRows, eventRows] = await Promise.all([
				getSmtpSettings(selectedProject.id),
				getDeliveryOutbox(selectedProject.id),
				getEmailDeadLetters(selectedProject.id),
				getProviderEvents(selectedProject.id),
			]);
			const rows = smtpResult.profiles || (smtpResult.id ? [smtpResult] : []);
			setProfiles(rows);
			setOutbox(outboxRows.filter((item) => ["queued", "failed"].includes(item.status)));
			setDeadLetters(deadLetterRows);
			setEventCount(eventRows.length);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		}
	}, [selectedProject]);
	useEffect(() => void load(), [load]);
	const run = async (action: () => Promise<unknown>, success: string) => {
		try {
			await action();
			showSuccessNotification(t(success));
			await load();
			return true;
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
			return false;
		}
	};
	return (
		<section className="space-y-4">
			<h2 className="text-lg font-semibold">{t("Email delivery operations")}</h2>
			{error && <p role="alert">{error}</p>}
			<p>{t("{count} provider events", { count: eventCount })}</p>

			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-6">
					<div className="grid gap-6 xl:grid-cols-3">
						<Card>
							<CardHeader>
								<CardTitle>{t("Delivery tests")}</CardTitle>
							</CardHeader>
							<CardContent className="space-y-3">
								<Input
									type="email"
									placeholder={t("Test recipient")}
									value={testRecipient}
									onChange={(event) => {
										setTestRecipient(event.target.value);
									}}
								/>
								{profiles.map((item) => (
									<div key={item.id} className="flex items-center justify-between">
										<span>{item.name}</span>
										<Button
											disabled={!testRecipient.trim()}
											variant="ghost"
											size="icon"
											aria-label={t("Test {name}", {
												name: item.name || "",
											})}
											onClick={() =>
												void run(
													() => testSmtpSettings(selectedProject.id, item.id, testRecipient.trim()),
													"Delivery test accepted",
												)
											}
										>
											<Send />
										</Button>
									</div>
								))}
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>{t("Retry queue")}</CardTitle>
								<CardDescription>
									{t("Transactional emails that are still queued or failed")}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-2">
								{outbox.length === 0 ? (
									<Empty text={t("No email is waiting or failed.")} />
								) : (
									outbox.map((item) => (
										<div
											key={item.id}
											className="flex items-center justify-between rounded-md border p-3"
										>
											<div>
												<p className="font-medium">{item.subject || t(item.job_type)}</p>
												<p className="text-xs text-muted-foreground">
													{t(item.status)}
													{item.last_error ? ` · ${item.last_error}` : ""}
												</p>
											</div>
											{["queued", "failed"].includes(item.status) && (
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
								<CardTitle>{t("Email dead letters")}</CardTitle>
								<CardDescription>
									{t("Inspect and resolve individual terminal Queue jobs")}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-2">
								{deadLetters.length === 0 ? (
									<Empty text={t("No email dead letters.")} />
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
														{item.resolution ? ` · ${item.resolution}` : ""} {t("·")}{" "}
														{item.attempts} {t("attempts")}
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
															aria-label={t("Replay dead letter {name}", {
																name: item.id,
															})}
															disabled={!item.replayable}
															title={t(
																item.replayable
																	? "Replay"
																	: "Payload was redacted and cannot be replayed",
															)}
															onClick={() =>
																void run(
																	() => replayEmailDeadLetter(selectedProject.id, item.id),
																	"Email job queued again",
																)
															}
														>
															<RotateCcw />
														</Button>
														<Button
															size="icon"
															variant="ghost"
															aria-label={t("Discard dead letter {name}", {
																name: item.id,
															})}
															onClick={() =>
																void run(
																	() => discardEmailDeadLetter(selectedProject.id, item.id),
																	"Email dead letter discarded",
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
				</div>
			)}
		</section>
	);
}

function Empty({ text }: { text: string }) {
	return <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>;
}
