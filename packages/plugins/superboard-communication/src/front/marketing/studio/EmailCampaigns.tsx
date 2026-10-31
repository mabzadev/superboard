import { emailPublicationIssues } from "@superboard/contracts/email-studio";
import { Button, Checkbox, Input, Loader, Select } from "@superboard/front-ui/kumo";
import {
	Table as FrontTable,
	TableHeader as FrontTableHeader,
	TableBody as FrontTableBody,
	TableRow as FrontTableRow,
	TableHead as FrontTableHead,
	TableCell as FrontTableCell,
} from "@superboard/front-ui/ui/table.js";
import { useCallback, useEffect, useState } from "react";

import {
	createEmailCampaign,
	getEmailCampaigns,
	getSubscriberLists,
	getSubscriberSegments,
	scheduleEmailCampaign,
	testEmailCampaign,
	transitionEmailCampaign,
	updateEmailCampaign,
	type EmailCampaign,
	type EmailTemplate,
	type SubscriberList,
	type SubscriberSegment,
} from "../api/marketing/marketingService.js";
import { useGrowthI18n as useStudioI18n } from "./growth-i18n.js";
import {
	deleteAbTest,
	getAbTest,
	getAbTests,
	saveAbTest,
	scheduleInRecipientTimeZones,
	type AbTest,
	type AbTestInput,
} from "./growth-service.js";
import { getCampaignPreflight, getStudioSenders, type CampaignPreflight } from "./service.js";

type AbSummary = Omit<AbTest, "results">;
type AbDraft = Omit<AbTestInput, "variants"> & {
	variants: Array<{ subject: string; template_id: string | null }>;
};
const VARIANT_LETTERS = ["A", "B", "C"];
const defaultAb = (): AbDraft => ({
	variants: [{ subject: "", template_id: null }],
	test_percent: 20,
	winner_metric: "open_rate",
	test_duration_minutes: 240,
});

export function EmailCampaigns({
	project,
	templates,
	templateId,
	onConfigureSender,
}: {
	project: string;
	templates: EmailTemplate[];
	templateId?: string;
	onConfigureSender?: () => void;
}) {
	const { t, locale } = useStudioI18n();
	const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
	const [lists, setLists] = useState<SubscriberList[]>([]);
	const [segments, setSegments] = useState<SubscriberSegment[]>([]);
	const [senders, setSenders] = useState<
		Array<{ id?: string; name?: string; from_email?: string }>
	>([]);
	const [form, setForm] = useState<Partial<EmailCampaign> | null>(null);
	const [step, setStep] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [scheduled, setScheduled] = useState("");
	const [testRecipient, setTestRecipient] = useState("");
	const [testMessage, setTestMessage] = useState("");
	const [preflight, setPreflight] = useState<CampaignPreflight>();
	const [abEnabled, setAbEnabled] = useState(false);
	const [ab, setAb] = useState<AbDraft>(defaultAb);
	const [abTests, setAbTests] = useState<Record<string, AbSummary>>({});
	const [results, setResults] = useState<AbTest | null>(null);
	const [localTime, setLocalTime] = useState(false);
	const fetchAll = useCallback(
		() =>
			Promise.all([
				getEmailCampaigns(project),
				getSubscriberLists(project),
				getSubscriberSegments(project),
				getStudioSenders(project),
				// A/B summaries only decorate the list; campaigns stay usable without them.
				getAbTests(project).catch(() => [] as AbSummary[]),
			]),
		[project],
	);
	const apply = useCallback(
		([values, groups, audienceSegments, senderProfiles, tests]: Awaited<
			ReturnType<typeof fetchAll>
		>) => {
			setCampaigns(templateId ? values.filter((item) => item.template_id === templateId) : values);
			setLists(groups);
			setSegments(audienceSegments);
			setSenders(senderProfiles);
			setAbTests(Object.fromEntries(tests.map((test) => [test.campaign_id, test])));
			setLoading(false);
		},
		[templateId],
	);
	/** Opens the editor with the campaign's A/B settings, or none for a new campaign. */
	const openForm = (value: Partial<EmailCampaign>) => {
		const test = value.id ? abTests[value.id] : undefined;
		setAbEnabled(Boolean(test));
		setAb(
			test
				? {
						variants: test.variants
							.slice(1)
							.map((variant) => ({ subject: variant.subject, template_id: variant.template_id })),
						test_percent: test.test_percent,
						winner_metric: test.winner_metric,
						test_duration_minutes: test.test_duration_minutes,
					}
				: defaultAb(),
		);
		setLocalTime(false);
		setForm(value);
		setStep(0);
		setPreflight(undefined);
	};
	const fail = useCallback(() => {
		setError(t("Loading failed"));
		setLoading(false);
	}, [t]);
	const load = useCallback(() => fetchAll().then(apply, fail), [fetchAll, apply, fail]);
	useEffect(() => {
		let active = true;
		void fetchAll().then(
			(values) => {
				if (active) apply(values);
			},
			() => {
				if (active) fail();
			},
		);
		return () => {
			active = false;
		};
	}, [fetchAll, apply, fail]);
	const template = templates.find((item) => item.id === form?.template_id);
	const saveDraft = async () => {
		if (!form) return;
		setBusy(true);
		setError("");
		try {
			const payload = {
				name: form.name,
				subject: form.subject,
				template_id: form.template_id,
				content_html: template?.content_html,
				content_text: template?.content_text,
				list_ids: form.list_ids,
				segment_ids: form.segment_ids,
				smtp_profile_id: form.smtp_profile_id,
				tracking_enabled: form.tracking_enabled ?? true,
			};
			const saved = form.id
				? await updateEmailCampaign(project, form.id, payload)
				: await createEmailCampaign(project, payload);
			if (abEnabled)
				await saveAbTest(project, saved.id, {
					...ab,
					variants: [{ subject: saved.subject, template_id: null }, ...ab.variants],
				});
			else if (abTests[saved.id]?.status === "pending") await deleteAbTest(project, saved.id);
			setForm(saved);
			setPreflight(await getCampaignPreflight(project, saved.id));
			setStep(2);
			await load();
		} catch {
			setError(t("Save failed"));
		} finally {
			setBusy(false);
		}
	};
	const run = async (action: () => Promise<unknown>) => {
		setBusy(true);
		setError("");
		try {
			await action();
			await load();
		} catch {
			setError(t("Save failed"));
		} finally {
			setBusy(false);
		}
	};
	if (loading) return <Loader />;
	return (
		<section className="space-y-5">
			<div className="flex justify-between">
				<h2 className="text-xl font-semibold">{t("Campaigns")}</h2>
				<Button
					variant="primary"
					onClick={() => {
						openForm({
							name: templateId ? (templates[0]?.name ?? "") : "",
							subject: templateId ? (templates[0]?.subject ?? "") : "",
							template_id: templateId,
							list_ids: [],
						});
					}}
				>
					{t("Create campaign")}
				</Button>
			</div>
			{error && (
				<p role="alert" className="text-kumo-danger">
					{error}
				</p>
			)}
			{!senders.length && (
				<div
					role="status"
					className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-kumo-line bg-kumo-tint p-4"
				>
					<p className="text-sm">
						{t("Configure a sender first: emails cannot be delivered without a sender identity.")}
					</p>
					{onConfigureSender && (
						<Button size="sm" onClick={onConfigureSender}>
							{t("Configure a sender")}
						</Button>
					)}
				</div>
			)}
			{form ? (
				<div className="grid gap-6 rounded-lg border border-kumo-line bg-kumo-base p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
					<div className="space-y-5">
						<nav className="flex gap-2" aria-label={t("Create campaign")}>
							{["Audience", "Content", "Review"].map((label, index) => (
								<Button
									key={label}
									variant={step === index ? "secondary" : "ghost"}
									disabled={index > step}
									onClick={() => setStep(index)}
								>
									{index + 1}. {t(label)}
								</Button>
							))}
						</nav>
						{step === 0 && (
							<>
								<Input
									label={t("Campaign name")}
									value={form.name ?? ""}
									onChange={(event) => setForm({ ...form, name: event.target.value })}
								/>
								<h3 className="font-medium">{t("Audience")}</h3>
								<p className="text-sm text-kumo-subtle">
									{t("Choose lists or send to all eligible subscribers.")}
								</p>
								{lists.map((list) => (
									<Checkbox
										key={list.id}
										label={`${list.name} (${list.subscriber_count ?? 0})`}
										checked={form.list_ids?.includes(list.id) ?? false}
										onCheckedChange={(checked) =>
											setForm({
												...form,
												list_ids: checked
													? [...(form.list_ids ?? []), list.id]
													: form.list_ids?.filter((id) => id !== list.id),
											})
										}
									/>
								))}
								<h3 className="font-medium">{t("Segments")}</h3>
								{segments.map((segment) => (
									<Checkbox
										key={segment.id}
										label={segment.name}
										checked={form.segment_ids?.includes(segment.id) ?? false}
										onCheckedChange={(checked) =>
											setForm({
												...form,
												segment_ids: checked
													? [...(form.segment_ids ?? []), segment.id]
													: form.segment_ids?.filter((id) => id !== segment.id),
											})
										}
									/>
								))}
								<Select
									label={t("Sender")}
									value={form.smtp_profile_id ?? ""}
									onValueChange={(value) => setForm({ ...form, smtp_profile_id: value || null })}
									items={{
										"": t("Automatic sender"),
										...Object.fromEntries(
											senders
												.filter((sender) => sender.id)
												.map((sender) => [
													sender.id!,
													sender.name || sender.from_email || sender.id!,
												]),
										),
									}}
								/>
								<Checkbox
									label={t("Track opens and clicks")}
									checked={form.tracking_enabled ?? true}
									onCheckedChange={(checked) => {
										setForm({ ...form, tracking_enabled: checked });
									}}
								/>
								<Button variant="primary" disabled={!form.name?.trim()} onClick={() => setStep(1)}>
									{t("Continue")}
								</Button>
							</>
						)}
						{step === 1 && (
							<>
								<Select
									label={t("Templates")}
									value={form.template_id ?? ""}
									onValueChange={(value) => {
										const selected = templates.find((item) => item.id === value);
										setForm({ ...form, template_id: value, subject: selected?.subject ?? "" });
									}}
									items={Object.fromEntries(templates.map((item) => [item.id, item.name]))}
								/>
								<Input
									label={t("Subject")}
									value={form.subject ?? ""}
									onChange={(event) => setForm({ ...form, subject: event.target.value })}
								/>
								<Checkbox
									label={t("A/B test")}
									checked={abEnabled}
									onCheckedChange={(checked) => {
										setAbEnabled(checked);
									}}
								/>
								{abEnabled && (
									<div className="space-y-3 rounded-lg border border-kumo-line p-4">
										<p className="text-sm text-kumo-subtle">
											{t(
												"Subject A is the subject above. Each variant goes to part of the test group.",
											)}
										</p>
										{ab.variants.map((variant, index) => (
											<div
												key={VARIANT_LETTERS[index + 1]}
												className="flex flex-wrap items-end gap-3"
											>
												<Input
													label={t("Subject {variant}", {
														variant: VARIANT_LETTERS[index + 1] ?? "",
													})}
													value={variant.subject}
													onChange={(event) => {
														setAb({
															...ab,
															variants: ab.variants.map((item, position) =>
																position === index
																	? { ...item, subject: event.target.value }
																	: item,
															),
														});
													}}
												/>
												{templates.length > 1 && (
													<Select
														label={t("Email")}
														value={variant.template_id ?? ""}
														onValueChange={(value) => {
															setAb({
																...ab,
																variants: ab.variants.map((item, position) =>
																	position === index
																		? { ...item, template_id: value || null }
																		: item,
																),
															});
														}}
														items={{
															"": t("Same email"),
															...Object.fromEntries(templates.map((item) => [item.id, item.name])),
														}}
													/>
												)}
												{index > 0 && (
													<Button
														variant="ghost"
														onClick={() => {
															setAb({
																...ab,
																variants: ab.variants.filter((_, position) => position !== index),
															});
														}}
													>
														{t("Remove")}
													</Button>
												)}
											</div>
										))}
										{ab.variants.length < 2 && (
											<Button
												size="sm"
												onClick={() => {
													setAb({
														...ab,
														variants: [...ab.variants, { subject: "", template_id: null }],
													});
												}}
											>
												{t("Add variant C")}
											</Button>
										)}
										<div className="grid gap-3 md:grid-cols-3">
											<Select
												label={t("Test group")}
												value={String(ab.test_percent)}
												onValueChange={(value) => {
													setAb({ ...ab, test_percent: Number(value) || 20 });
												}}
												items={{ "10": "10%", "20": "20%", "30": "30%", "50": "50%" }}
											/>
											<Select
												label={t("Winner")}
												value={ab.winner_metric}
												onValueChange={(value) => {
													setAb({
														...ab,
														winner_metric: value === "click_rate" ? "click_rate" : "open_rate",
													});
												}}
												items={{
													open_rate: t("Highest open rate"),
													click_rate: t("Highest click rate"),
												}}
											/>
											<Select
												label={t("Test duration")}
												value={String(ab.test_duration_minutes)}
												onValueChange={(value) => {
													setAb({ ...ab, test_duration_minutes: Number(value) || 240 });
												}}
												items={{
													"60": t("1 hour"),
													"240": t("4 hours"),
													"720": t("12 hours"),
													"1440": t("24 hours"),
												}}
											/>
										</div>
										<p className="text-sm">
											{t(
												"{percent}% of the audience receives the variants. After the test, the winner is sent to everyone else.",
												{ percent: ab.test_percent },
											)}
										</p>
									</div>
								)}
								<div className="flex flex-wrap gap-2">
									{Object.entries(template?.studio_document?.locales ?? {}).map(
										([key, translation]) => (
											<span key={key} className="rounded-md bg-kumo-tint px-3 py-2 text-xs">
												{key.toUpperCase()} · {t(translation.status)}
											</span>
										),
									)}
								</div>
								<Button
									variant="primary"
									disabled={
										busy ||
										!form.subject ||
										!template ||
										(abEnabled && ab.variants.some((variant) => !variant.subject.trim()))
									}
									onClick={() => void saveDraft()}
								>
									{t("Save and review")}
								</Button>
							</>
						)}
						{step === 2 && (
							<>
								<h3 className="text-lg font-semibold">{t("Review delivery")}</h3>
								{preflight && (
									<>
										<div className="flex gap-6">
											<p>
												{t("Eligible recipients")} <strong>{preflight.eligible}</strong>
											</p>
											<p>
												{t("Excluded")} <strong>{preflight.excluded}</strong>
											</p>
										</div>
										<FrontTable className="w-full text-start text-sm">
											<FrontTableHeader>
												<FrontTableRow>
													{["Language", "Recipients", "Fallback"].map((label) => (
														<FrontTableHead key={label} className="p-2 text-start">
															{t(label)}
														</FrontTableHead>
													))}
												</FrontTableRow>
											</FrontTableHeader>
											<FrontTableBody>
												{preflight.languages.map((item) => (
													<FrontTableRow key={item.locale} className="border-t border-kumo-line">
														<FrontTableCell className="p-2">{item.locale}</FrontTableCell>
														<FrontTableCell>{item.count}</FrontTableCell>
														<FrontTableCell>{item.fallback}</FrontTableCell>
													</FrontTableRow>
												))}
											</FrontTableBody>
										</FrontTable>
										{preflight.issues.map((issue) => (
											<p key={issue} role="alert" className="text-kumo-danger">
												{t(issue)}
											</p>
										))}
									</>
								)}
								<div className="flex flex-wrap items-end gap-3 rounded-lg border border-kumo-line p-4">
									<Input
										type="email"
										label={t("Send a test to")}
										value={testRecipient}
										onChange={(event) => {
											setTestRecipient(event.target.value);
										}}
									/>
									<Button
										disabled={busy || !form.id || !testRecipient.trim()}
										onClick={() => {
											if (!form.id) return;
											setBusy(true);
											setTestMessage("");
											testEmailCampaign(project, form.id, testRecipient.trim())
												.then(() => {
													setTestMessage(t("Test email accepted"));
												})
												.catch(() => {
													setTestMessage(t("Test email failed"));
												})
												.finally(() => {
													setBusy(false);
												});
										}}
									>
										{t("Send test")}
									</Button>
									<p role="status" className="text-sm">
										{testMessage}
									</p>
								</div>
								<Input
									type="datetime-local"
									label={
										localTime
											? t("Local send time")
											: t("Schedule") + " · " + Intl.DateTimeFormat().resolvedOptions().timeZone
									}
									value={scheduled}
									onChange={(event) => setScheduled(event.target.value)}
								/>
								{!abEnabled && (
									<div className="space-y-1">
										<Checkbox
											label={t("Send at this local time in each contact's time zone")}
											checked={localTime}
											onCheckedChange={(checked) => {
												setLocalTime(checked);
											}}
										/>
										{localTime && (
											<p className="text-sm text-kumo-subtle">
												{t("Contacts without a time zone use the project time zone from Settings.")}
											</p>
										)}
									</div>
								)}
								<div className="flex gap-3">
									<Button
										variant="primary"
										disabled={
											busy || !form.id || !preflight || preflight.issues.length > 0 || !scheduled
										}
										onClick={() =>
											void run(async () => {
												const id = form.id;
												if (!id) return;
												if (localTime && !abEnabled)
													await scheduleInRecipientTimeZones(project, id, scheduled.slice(0, 16));
												else
													await scheduleEmailCampaign(
														project,
														id,
														new Date(scheduled).toISOString(),
													);
												setForm(null);
											})
										}
									>
										{t("Schedule campaign")}
									</Button>
									<Button
										disabled={busy || !form.id || !preflight || preflight.issues.length > 0}
										onClick={() =>
											void run(async () => {
												await transitionEmailCampaign(project, form.id!, "start");
												setForm(null);
											})
										}
									>
										{t("Send now")}
									</Button>
								</div>
							</>
						)}
					</div>
					<aside className="space-y-4 rounded-lg bg-kumo-tint p-5">
						<p className="font-medium">{form.name || t("Campaign name")}</p>
						<p className="text-sm">{form.subject}</p>
						<p className="text-xs text-kumo-subtle">{template?.name}</p>
						{template?.studio_document &&
							emailPublicationIssues(template.studio_document).map((issue) => (
								<p key={issue} className="text-sm text-kumo-danger">
									{t(issue)}
								</p>
							))}
						<Button variant="ghost" onClick={() => setForm(null)}>
							{t("Close")}
						</Button>
					</aside>
				</div>
			) : (
				<div className="overflow-auto rounded-lg border border-kumo-line">
					<FrontTable className="w-full text-start text-sm">
						<FrontTableHeader className="bg-kumo-tint">
							<FrontTableRow>
								{["Campaign", "Status", "Recipients", "Scheduled", "Actions"].map((label) => (
									<FrontTableHead key={label} className="p-4 text-start font-medium">
										{t(label)}
									</FrontTableHead>
								))}
							</FrontTableRow>
						</FrontTableHeader>
						<FrontTableBody>
							{campaigns.map((campaign) => (
								<FrontTableRow key={campaign.id} className="border-t border-kumo-line">
									<FrontTableCell className="p-4">
										<p className="font-medium">{campaign.name}</p>
										<p className="mt-1 text-xs text-kumo-subtle">{campaign.subject}</p>
										<AbStatus test={abTests[campaign.id]} />
									</FrontTableCell>
									<FrontTableCell>{t(campaign.status)}</FrontTableCell>
									<FrontTableCell>{campaign.recipient_count ?? 0}</FrontTableCell>
									<FrontTableCell>
										{campaign.scheduled_at
											? new Date(campaign.scheduled_at).toLocaleString(locale)
											: "—"}
									</FrontTableCell>
									<FrontTableCell className="p-3">
										<div className="flex gap-2">
											{["draft", "paused", "scheduled"].includes(campaign.status) && (
												<Button
													size="sm"
													onClick={() => {
														openForm(campaign);
													}}
												>
													{t("Edit")}
												</Button>
											)}
											{["running", "scheduled"].includes(campaign.status) && (
												<Button
													size="sm"
													disabled={busy}
													onClick={() =>
														void run(() => transitionEmailCampaign(project, campaign.id, "pause"))
													}
												>
													{t("Pause")}
												</Button>
											)}
											{campaign.status === "paused" && (
												<Button
													size="sm"
													disabled={busy}
													onClick={() =>
														void run(() => transitionEmailCampaign(project, campaign.id, "resume"))
													}
												>
													{t("Resume")}
												</Button>
											)}
											{abTests[campaign.id] && abTests[campaign.id]?.status !== "pending" && (
												<Button
													size="sm"
													onClick={() => {
														if (results?.campaign_id === campaign.id) setResults(null);
														else
															getAbTest(project, campaign.id).then(setResults, () => {
																setError(t("Loading failed"));
															});
													}}
												>
													{t("A/B results")}
												</Button>
											)}
											<Button
												size="sm"
												onClick={() => {
													openForm({
														...campaign,
														id: undefined,
														name: `${campaign.name} · ${t("Copy")}`,
													});
												}}
											>
												{t("Duplicate")}
											</Button>
										</div>
									</FrontTableCell>
								</FrontTableRow>
							))}
						</FrontTableBody>
					</FrontTable>
					{!campaigns.length && (
						<p className="p-6 text-kumo-subtle">
							{t("No sends yet. Create a campaign to choose an audience, test it and schedule it.")}
						</p>
					)}
				</div>
			)}
			{results && !form && (
				<section
					className="space-y-3 rounded-lg border border-kumo-line p-5"
					aria-label={t("A/B results")}
				>
					<div className="flex items-center justify-between gap-3">
						<h3 className="font-medium">
							{t("A/B results")} ·{" "}
							{t(
								results.winner_metric === "click_rate" ? "Highest click rate" : "Highest open rate",
							)}
						</h3>
						<Button
							variant="ghost"
							onClick={() => {
								setResults(null);
							}}
						>
							{t("Close")}
						</Button>
					</div>
					<FrontTable className="w-full text-start text-sm">
						<FrontTableHeader>
							<FrontTableRow>
								{["Variant", "Subject", "Recipients", "Open rate", "Click rate"].map((label) => (
									<FrontTableHead key={label} className="p-2 text-start">
										{t(label)}
									</FrontTableHead>
								))}
							</FrontTableRow>
						</FrontTableHeader>
						<FrontTableBody>
							{results.variants.map((variant) => {
								const row = results.results.find((item) => item.variant_id === variant.id);
								return (
									<FrontTableRow key={variant.id} className="border-t border-kumo-line">
										<FrontTableCell className="p-2 font-medium">
											{variant.id.toUpperCase()}
											{results.winner_variant_id === variant.id ? ` · ${t("Winner")}` : ""}
										</FrontTableCell>
										<FrontTableCell>{variant.subject}</FrontTableCell>
										<FrontTableCell>{row?.recipients ?? 0}</FrontTableCell>
										<FrontTableCell>{(row?.open_rate ?? 0).toLocaleString(locale)}%</FrontTableCell>
										<FrontTableCell>
											{(row?.click_rate ?? 0).toLocaleString(locale)}%
										</FrontTableCell>
									</FrontTableRow>
								);
							})}
						</FrontTableBody>
					</FrontTable>
				</section>
			)}
		</section>
	);
}

function AbStatus({ test }: { test?: AbSummary }) {
	const { t } = useStudioI18n();
	if (!test) return null;
	return (
		<p className="mt-1 text-xs">
			{t("A/B test")} ·{" "}
			{test.winner_variant_id
				? t("Winner: {variant}", { variant: test.winner_variant_id.toUpperCase() })
				: t(test.status === "testing" ? "Test running" : "Waiting to send")}
		</p>
	);
}
