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
import { Switch } from "@superboard/front-ui/ui/switch.js";
import { Cloud, Mail, Plus, RotateCcw, Send, Settings, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
	discardEmailDeadLetter,
	deleteSmtpSettings,
	getDeliveryOutbox,
	getProviderEvents,
	getEmailDeadLetters,
	getSmtpSettings,
	replayEmailDeadLetter,
	retryDeliveryOutbox,
	saveSmtpSettings,
	testSmtpSettings,
	type DeliveryOutboxItem,
	type EmailDeadLetter,
	type SmtpSettings,
} from "../../api/email/emailService.js";
import { useEmailI18n } from "./email-i18n.js";
import { EmailDeveloperSettings } from "./EmailDeveloperSettings.js";
import { SenderDomainAuthentication } from "./SenderDomainAuthentication.js";

const selectClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";

export function EmailAdministration({
	section = "operations",
}: {
	section?: "delivery" | "operations";
}) {
	const { t } = useEmailI18n();
	const { selectedProject } = useProjectSelection();
	const [authenticating, setAuthenticating] = useState<string | null>(null);
	const [profiles, setProfiles] = useState<SmtpSettings[]>([]);
	const [deliveryProvider, setDeliveryProvider] = useState<"smtp" | "aws-ses">("smtp");
	const [awsRegion, setAwsRegion] = useState<string | null>(null);
	const [outbox, setOutbox] = useState<DeliveryOutboxItem[]>([]);
	const [deadLetters, setDeadLetters] = useState<EmailDeadLetter[]>([]);
	const [eventCount, setEventCount] = useState(0);
	const [smtp, setSmtp] = useState<SmtpSettings>({
		id: crypto.randomUUID(),
		name: t("Default"),
		configured: false,
		port: 587,
		security: "starttls",
		priority: 100,
		enabled: true,
	});
	const [password, setPassword] = useState("");
	const [testRecipient, setTestRecipient] = useState("");
	const [error, setError] = useState<string | null>(null);
	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const [smtpResult, outboxRows, deadLetterRows, eventRows] = await Promise.all([
				getSmtpSettings(selectedProject.id),
				section === "operations" ? getDeliveryOutbox(selectedProject.id) : Promise.resolve([]),
				section === "operations" ? getEmailDeadLetters(selectedProject.id) : Promise.resolve([]),
				section === "operations" ? getProviderEvents(selectedProject.id) : Promise.resolve([]),
			]);
			const rows = smtpResult.profiles || (smtpResult.id ? [smtpResult] : []);
			setProfiles(rows);
			setDeliveryProvider(smtpResult.provider || "smtp");
			setAwsRegion(smtpResult.aws_region || null);
			// Only messages that still wait or failed need an operator here; the full history is in the message log.
			setOutbox(outboxRows.filter((item) => ["queued", "failed"].includes(item.status)));
			setDeadLetters(deadLetterRows);
			setEventCount(eventRows.length);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		}
	}, [selectedProject, section]);
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
	const reset = () => {
		setSmtp({
			id: crypto.randomUUID(),
			name: t("Sender {number}", { number: profiles.length + 1 }),
			configured: false,
			port: 587,
			security: "starttls",
			priority: (profiles.length + 1) * 100,
			enabled: true,
		});
		setPassword("");
	};
	const save = async () => {
		if (!selectedProject) return;
		if (
			await run(
				() =>
					saveSmtpSettings(selectedProject.id, {
						...smtp,
						password: password || undefined,
						hourly_quota: smtp.hourly_quota || null,
						daily_quota: smtp.daily_quota || null,
					}),
				deliveryProvider === "aws-ses"
					? "Amazon SES sender identity saved"
					: "SMTP sender profile encrypted and saved",
			)
		)
			setPassword("");
	};
	return (
		<section className="space-y-4">
			<h2 className="text-lg font-semibold">
				{section === "operations" ? t("Email delivery operations") : t("Sender identities")}
			</h2>
			{error && <p role="alert">{error}</p>}
			{section === "operations" && <p>{t("{count} provider events", { count: eventCount })}</p>}

			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-6">
					{section === "delivery" && (
						<div className="grid gap-6 xl:grid-cols-[420px_1fr]">
							<FormCard title={t("Sender identity")}>
								{deliveryProvider === "aws-ses" ? (
									<div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
										<div className="flex items-center gap-3">
											<div className="rounded-lg bg-primary/10 p-2 text-primary">
												<Cloud className="size-5" />
											</div>
											<div>
												<p className="font-medium">{t("Amazon SES managed delivery")}</p>
												<p className="text-xs text-muted-foreground">
													{awsRegion || "AWS region"} {t("· STARTTLS · port 587")}
												</p>
											</div>
										</div>
										<p className="mt-3 text-xs text-muted-foreground">
											{t(
												"Credentials are owned by the central Email Worker. They are never stored in a project or exposed in this interface.",
											)}
										</p>
									</div>
								) : null}
								<Input
									placeholder={t("Profile name")}
									value={smtp.name || ""}
									onChange={(event) => {
										setSmtp((value) => ({
											...value,
											name: event.target.value,
										}));
									}}
								/>
								{deliveryProvider === "smtp" ? (
									<>
										<div className="grid grid-cols-[1fr_100px] gap-2">
											<Input
												placeholder={t("SMTP host")}
												value={smtp.host || ""}
												onChange={(event) => {
													setSmtp((value) => ({
														...value,
														host: event.target.value,
													}));
												}}
											/>
											<Input
												aria-label={t("SMTP port")}
												type="number"
												value={smtp.port || 587}
												onChange={(event) => {
													setSmtp((value) => ({
														...value,
														port: Number(event.target.value),
													}));
												}}
											/>
										</div>
										<select
											aria-label={t("SMTP security")}
											className={selectClass}
											value={smtp.security || "starttls"}
											onChange={(event) => {
												setSmtp((value) => ({
													...value,
													security: event.target.value,
												}));
											}}
										>
											<option value="tls">{t("TLS")}</option>
											<option value="starttls">{t("STARTTLS")}</option>
											<option value="plain">{t("Plain")}</option>
										</select>
										<Input
											placeholder={t("Username")}
											value={smtp.username || ""}
											onChange={(event) => {
												setSmtp((value) => ({
													...value,
													username: event.target.value,
												}));
											}}
										/>
										<Input
											type="password"
											autoComplete="new-password"
											placeholder={t(
												smtp.configured ? "Leave blank to keep encrypted password" : "Password",
											)}
											value={password}
											onChange={(event) => {
												setPassword(event.target.value);
											}}
										/>
									</>
								) : null}
								<Input
									type="email"
									placeholder={t("From email")}
									value={smtp.from_email || ""}
									onChange={(event) => {
										setSmtp((value) => ({
											...value,
											from_email: event.target.value,
										}));
									}}
								/>
								<Input
									placeholder={t("DKIM selector (for example: mail)")}
									value={smtp.dkim_selector || ""}
									onChange={(event) => {
										setSmtp((value) => ({
											...value,
											dkim_selector: event.target.value || null,
										}));
									}}
								/>
								<Input
									placeholder={t("From name")}
									value={smtp.from_name || ""}
									onChange={(event) => {
										setSmtp((value) => ({
											...value,
											from_name: event.target.value,
										}));
									}}
								/>
								<Input
									type="email"
									placeholder={t("Reply-to email (optional)")}
									value={smtp.reply_to || ""}
									onChange={(event) => {
										setSmtp((value) => ({
											...value,
											reply_to: event.target.value || null,
										}));
									}}
								/>
								<div className="grid grid-cols-3 gap-2">
									<Input
										aria-label={t("SMTP priority")}
										type="number"
										placeholder={t("Priority")}
										value={smtp.priority || 100}
										onChange={(event) => {
											setSmtp((value) => ({
												...value,
												priority: Number(event.target.value),
											}));
										}}
									/>
									<Input
										type="number"
										placeholder={t("Hourly quota")}
										value={smtp.hourly_quota || ""}
										onChange={(event) => {
											setSmtp((value) => ({
												...value,
												hourly_quota: Number(event.target.value) || null,
											}));
										}}
									/>
									<Input
										type="number"
										placeholder={t("Daily quota")}
										value={smtp.daily_quota || ""}
										onChange={(event) => {
											setSmtp((value) => ({
												...value,
												daily_quota: Number(event.target.value) || null,
											}));
										}}
									/>
								</div>
								<label className="flex items-center gap-2 text-sm">
									<Switch
										checked={smtp.enabled ?? true}
										onCheckedChange={(enabled) => {
											setSmtp((value) => ({ ...value, enabled }));
										}}
									/>
									{t("Enabled for failover pool")}
								</label>
								<div className="flex gap-2">
									<Button variant="outline" onClick={reset}>
										<Plus />
										{t("New profile")}
									</Button>
									<Button
										disabled={
											!smtp.from_email ||
											(deliveryProvider === "smtp" &&
												(!smtp.host || (!smtp.configured && !password)))
										}
										onClick={() => void save()}
									>
										<Mail />
										{t("Save profile")}
									</Button>
								</div>
							</FormCard>
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2">
										<Settings />
										{t("Sender identities")}
									</CardTitle>
									<CardDescription>
										{t("{count} configured", { count: profiles.length })}
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-3">
									{profiles.length === 0 ? (
										<Empty
											text={t(
												"No sender identity yet. Add one with the form, then verify its domain: emails cannot be delivered without it.",
											)}
										/>
									) : (
										profiles.map((item) => (
											<div key={item.id} className="rounded-md border p-3">
												<div className="flex items-center justify-between">
													<button
														className="text-start"
														type="button"
														onClick={() => {
															setSmtp(item);
															setPassword("");
														}}
													>
														<p className="font-medium">{item.name}</p>
														<p className="text-xs text-muted-foreground">
															{deliveryProvider === "aws-ses"
																? `Amazon SES · ${awsRegion || "managed region"}`
																: `${item.host}:${item.port}`}{" "}
															{t("· priority")}
															{item.priority} {t("·")} {item.last_test_status || "untested"}
														</p>
														<p className="text-xs text-muted-foreground">
															{t("Sender DNS:")}
															{t(item.authentication_status || "unverified")} {t("· SPF")}{" "}
															{t(item.spf_status || "unchecked")} {t("· DKIM")}{" "}
															{t(item.dkim_status || "unchecked")} {t("· DMARC")}{" "}
															{t(item.dmarc_status || "unchecked")}
														</p>
													</button>
													<div className="flex">
														<Button
															variant={authenticating === item.id ? "secondary" : "ghost"}
															size="icon"
															aria-label={t("Open domain authentication for {name}", {
																name: item.name || "",
															})}
															aria-expanded={authenticating === item.id}
															title={t("Domain authentication")}
															disabled={!item.id}
															onClick={() => {
																setAuthenticating((current) =>
																	current === item.id ? null : (item.id ?? null),
																);
															}}
														>
															<ShieldCheck />
														</Button>

														<Button
															variant="ghost"
															size="icon"
															aria-label={t("Delete {name}", {
																name: item.name || "",
															})}
															onClick={() =>
																item.id &&
																void run(
																	() => deleteSmtpSettings(selectedProject.id, item.id!),
																	"Sender identity deleted",
																)
															}
														>
															<Trash2 />
														</Button>
													</div>
												</div>
												{item.id && authenticating === item.id && (
													<SenderDomainAuthentication
														project={selectedProject.id}
														profileId={item.id}
														onVerified={() => void load()}
													/>
												)}
											</div>
										))
									)}
								</CardContent>
							</Card>
						</div>
					)}
					{section === "delivery" && <EmailDeveloperSettings project={selectedProject.id} />}
					<div className="grid gap-6 xl:grid-cols-3">
						{section === "operations" && (
							<>
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
															() =>
																testSmtpSettings(selectedProject.id, item.id, testRecipient.trim()),
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
							</>
						)}
					</div>
				</div>
			)}
		</section>
	);
}

function FormCard({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">{children}</CardContent>
		</Card>
	);
}

function Empty({ text }: { text: string }) {
	return <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>;
}
