import { emailPublicationIssues } from "@superboard/contracts/email-studio";
import { Button, Checkbox, Input, Loader, Select } from "@superboard/front-ui/kumo";
import { useCallback, useEffect, useState } from "react";

import {
	createEmailCampaign,
	getEmailCampaigns,
	getSubscriberLists,
	getSubscriberSegments,
	scheduleEmailCampaign,
	transitionEmailCampaign,
	updateEmailCampaign,
	type EmailCampaign,
	type EmailTemplate,
	type SubscriberList,
	type SubscriberSegment,
} from "../source/api/marketing/marketingService.js";
import { useStudioI18n } from "./i18n.js";
import { getCampaignPreflight, getStudioSenders, type CampaignPreflight } from "./service.js";

export function EmailCampaigns({
	project,
	templates,
}: {
	project: string;
	templates: EmailTemplate[];
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
	const [preflight, setPreflight] = useState<CampaignPreflight>();
	const load = useCallback(async () => {
		try {
			const [values, groups, audienceSegments, senderProfiles] = await Promise.all([
				getEmailCampaigns(project),
				getSubscriberLists(project),
				getSubscriberSegments(project),
				getStudioSenders(project),
			]);
			setCampaigns(values);
			setLists(groups);
			setSegments(audienceSegments);
			setSenders(senderProfiles);
		} catch {
			setError(t("Loading failed"));
		} finally {
			setLoading(false);
		}
	}, [project, t]);
	useEffect(() => {
		void load();
	}, [load]);
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
				tracking_enabled: true,
			};
			const saved = form.id
				? await updateEmailCampaign(project, form.id, payload)
				: await createEmailCampaign(project, payload);
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
						setForm({ name: "", subject: "", list_ids: [] });
						setStep(0);
						setPreflight(undefined);
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
			{form ? (
				<div className="grid gap-6 rounded-xl border border-kumo-line bg-kumo-base p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
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
									disabled={busy || !form.subject || !template}
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
										<table className="w-full text-start text-sm">
											<thead>
												<tr>
													{["Language", "Recipients", "Fallback"].map((label) => (
														<th key={label} className="p-2 text-start">
															{t(label)}
														</th>
													))}
												</tr>
											</thead>
											<tbody>
												{preflight.languages.map((item) => (
													<tr key={item.locale} className="border-t border-kumo-line">
														<td className="p-2">{item.locale}</td>
														<td>{item.count}</td>
														<td>{item.fallback}</td>
													</tr>
												))}
											</tbody>
										</table>
										{preflight.issues.map((issue) => (
											<p key={issue} role="alert" className="text-kumo-danger">
												{t(issue)}
											</p>
										))}
									</>
								)}
								<Input
									type="datetime-local"
									label={t("Schedule") + " · " + Intl.DateTimeFormat().resolvedOptions().timeZone}
									value={scheduled}
									onChange={(event) => setScheduled(event.target.value)}
								/>
								<div className="flex gap-3">
									<Button
										variant="primary"
										disabled={
											busy || !form.id || !preflight || preflight.issues.length > 0 || !scheduled
										}
										onClick={() =>
											void run(async () => {
												await scheduleEmailCampaign(
													project,
													form.id!,
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
					<aside className="space-y-4 rounded-xl bg-kumo-tint p-5">
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
				<div className="overflow-auto rounded-xl border border-kumo-line">
					<table className="w-full text-start text-sm">
						<thead className="bg-kumo-tint">
							<tr>
								{["Campaign", "Status", "Recipients", "Scheduled", "Actions"].map((label) => (
									<th key={label} className="p-4 text-start font-medium">
										{t(label)}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{campaigns.map((campaign) => (
								<tr key={campaign.id} className="border-t border-kumo-line">
									<td className="p-4">
										<p className="font-medium">{campaign.name}</p>
										<p className="mt-1 text-xs text-kumo-subtle">{campaign.subject}</p>
									</td>
									<td>{t(campaign.status)}</td>
									<td>{campaign.recipient_count ?? 0}</td>
									<td>
										{campaign.scheduled_at
											? new Date(campaign.scheduled_at).toLocaleString(locale)
											: "—"}
									</td>
									<td className="p-3">
										<div className="flex gap-2">
											{["draft", "paused", "scheduled"].includes(campaign.status) && (
												<Button
													size="sm"
													onClick={() => {
														setForm(campaign);
														setStep(0);
														setPreflight(undefined);
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
											<Button
												size="sm"
												onClick={() => {
													setForm({
														...campaign,
														id: undefined,
														name: `${campaign.name} · ${t("Copy")}`,
													});
													setStep(0);
													setPreflight(undefined);
												}}
											>
												{t("Duplicate")}
											</Button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{!campaigns.length && <p className="p-6 text-kumo-subtle">{t("No campaigns yet")}</p>}
				</div>
			)}
		</section>
	);
}
