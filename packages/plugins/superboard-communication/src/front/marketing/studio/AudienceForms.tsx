import { Button, Checkbox, Input, InputArea, Loader, Select } from "@superboard/front-ui/kumo";
import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { EmptyState } from "@superboard/front-ui/ui/widgets.js";
import { useCallback, useEffect, useState } from "react";

import { getSubscriberLists, type SubscriberList } from "../api/marketing/marketingService.js";
import {
	createSignupForm,
	deleteSignupForm,
	getAudienceFields,
	getSignupFormEmbed,
	getSignupForms,
	updateSignupForm,
	type AudienceField,
	type SignupForm,
	type SignupFormEmbed,
	type SignupFormSettings,
} from "./audience-service.js";
import { useStudioI18n } from "./i18n.js";

type Draft = SignupFormSettings & { id?: string; name: string; status: "active" | "disabled" };

function emptyDraft(locale: string): Draft {
	const french = locale.startsWith("fr");
	return {
		name: "",
		status: "active",
		locale: french ? "fr" : "en",
		title: "",
		description: null,
		submit_label: "",
		fields: [{ key: "name", required: false }],
		list_ids: [],
		double_opt_in: true,
		success_message: null,
		redirect_url: null,
		popup: { enabled: false, delay_seconds: 5 },
	};
}

/** Signup forms: list, a single editor with sensible defaults and copy-paste snippets. */
export function AudienceForms({ project }: { project: string }) {
	const { t, locale } = useStudioI18n();
	const [forms, setForms] = useState<SignupForm[]>([]);
	const [lists, setLists] = useState<SubscriberList[]>([]);
	const [fields, setFields] = useState<AudienceField[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [draft, setDraft] = useState<Draft | null>(null);
	const [embed, setEmbed] = useState<{ form: SignupForm; snippets: SignupFormEmbed } | null>(null);
	const [copied, setCopied] = useState("");
	const fetchAll = useCallback(
		() =>
			Promise.all([
				getSignupForms(project),
				getSubscriberLists(project),
				getAudienceFields(project),
			]),
		[project],
	);
	const apply = useCallback(
		([nextForms, nextLists, nextFields]: [SignupForm[], SubscriberList[], AudienceField[]]) => {
			setForms(nextForms);
			setLists(nextLists);
			setFields(nextFields);
			setLoading(false);
		},
		[],
	);
	const fail = useCallback(() => {
		setError(t("Loading failed"));
		setLoading(false);
	}, [t]);
	const reload = useCallback(() => fetchAll().then(apply, fail), [fetchAll, apply, fail]);
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
	const run = async (action: () => Promise<unknown>) => {
		setBusy(true);
		setError("");
		try {
			await action();
			await reload();
			return true;
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
			return false;
		} finally {
			setBusy(false);
		}
	};
	const showEmbed = async (form: SignupForm) => {
		setError("");
		try {
			setEmbed({ form, snippets: await getSignupFormEmbed(project, form.id) });
			setDraft(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
		}
	};
	const copy = async (label: string, value: string) => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(label);
			setTimeout(() => {
				setCopied("");
			}, 2000);
		} catch {
			setCopied("");
		}
	};
	if (loading) return <Loader />;
	const fieldChoices = [
		{ key: "name", label: t("Name") },
		...fields.map((field) => ({ key: field.key, label: field.label })),
	];
	return (
		<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
			<section className="space-y-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<p className="text-sm text-kumo-subtle">
						{t(
							"Collect subscribers from your website with an embedded form or a popup. Submissions are protected against bots and repeated attempts.",
						)}
					</p>
					<Button
						variant="primary"
						onClick={() => {
							setEmbed(null);
							setDraft(emptyDraft(locale));
						}}
					>
						{t("Create form")}
					</Button>
				</div>
				{error && (
					<p role="alert" className="text-kumo-danger">
						{error}
					</p>
				)}
				{forms.length ? (
					<ul className="divide-y divide-kumo-line rounded-lg border border-kumo-line">
						{forms.map((form) => (
							<li key={form.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
								<div>
									<p className="font-medium">{form.name}</p>
									<p className="text-xs text-kumo-subtle">
										{t(form.status === "active" ? "Active" : "Disabled")} ·{" "}
										{t(form.settings.popup.enabled ? "Popup" : "Embedded form")} ·{" "}
										{t("{count} submissions", { count: form.submission_count })}
									</p>
								</div>
								<div className="flex flex-wrap gap-2">
									<Button size="sm" onClick={() => void showEmbed(form)}>
										{t("Get code")}
									</Button>
									<Button
										size="sm"
										onClick={() => {
											setEmbed(null);
											setDraft({
												...form.settings,
												id: form.id,
												name: form.name,
												status: form.status,
											});
										}}
									>
										{t("Edit")}
									</Button>
									<Button
										size="sm"
										variant="ghost"
										disabled={busy}
										aria-label={t("Delete {name}", { name: form.name })}
										onClick={() =>
											void run(async () => {
												await deleteSignupForm(project, form.id);
												if (embed?.form.id === form.id) setEmbed(null);
											})
										}
									>
										{t("Delete")}
									</Button>
								</div>
							</li>
						))}
					</ul>
				) : (
					<EmptyState
						title={t("No signup forms yet")}
						description={t(
							"Create a form, choose the lists it subscribes to and paste the code on your website.",
						)}
					/>
				)}
			</section>
			{draft && (
				<form
					className="space-y-3 rounded-lg border border-kumo-line bg-kumo-base p-5"
					onSubmit={(event) => {
						event.preventDefault();
						const { id, ...values } = draft;
						const payload = {
							...values,
							title: values.title.trim() || undefined,
							submit_label: values.submit_label.trim() || undefined,
						};
						run(async () => {
							const saved = id
								? await updateSignupForm(project, id, payload)
								: await createSignupForm(project, payload);
							setDraft(null);
							if (!id) await showEmbed(saved);
						}).catch(() => undefined);
					}}
				>
					<h2 className="font-semibold">{t(draft.id ? "Edit form" : "Create form")}</h2>
					<Input
						label={t("Form name")}
						value={draft.name}
						required
						onChange={(event) => {
							setDraft({ ...draft, name: event.target.value });
						}}
					/>
					<Input
						label={t("Title")}
						placeholder={t("Subscribe to our newsletter")}
						value={draft.title}
						onChange={(event) => {
							setDraft({ ...draft, title: event.target.value });
						}}
					/>
					<fieldset className="space-y-2">
						<legend className="text-sm font-medium">{t("Fields")}</legend>
						<p className="text-xs text-kumo-subtle">{t("Email is always asked.")}</p>
						{fieldChoices.map((choice) => {
							const current = draft.fields.find((field) => field.key === choice.key);
							return (
								<div key={choice.key} className="flex flex-wrap items-center gap-4">
									<Checkbox
										label={choice.label}
										checked={Boolean(current)}
										disabled={!current && draft.fields.length >= 8}
										onCheckedChange={(checked) => {
											setDraft({
												...draft,
												fields: checked
													? [...draft.fields, { key: choice.key, required: false }]
													: draft.fields.filter((field) => field.key !== choice.key),
											});
										}}
									/>
									{current && (
										<Checkbox
											label={t("Required")}
											checked={current.required}
											onCheckedChange={(checked) => {
												setDraft({
													...draft,
													fields: draft.fields.map((field) =>
														field.key === choice.key ? { ...field, required: checked } : field,
													),
												});
											}}
										/>
									)}
								</div>
							);
						})}
					</fieldset>
					<fieldset className="space-y-2">
						<legend className="text-sm font-medium">{t("Subscribe to")}</legend>
						{lists.length ? (
							lists.map((list) => (
								<Checkbox
									key={list.id}
									label={list.name}
									checked={draft.list_ids.includes(list.id)}
									onCheckedChange={(checked) => {
										setDraft({
											...draft,
											list_ids: checked
												? [...draft.list_ids, list.id]
												: draft.list_ids.filter((id) => id !== list.id),
										});
									}}
								/>
							))
						) : (
							<p className="text-xs text-kumo-subtle">
								{t("No lists yet: contacts are added to your audience without a list.")}
							</p>
						)}
					</fieldset>
					<Checkbox
						label={t("Ask for confirmation by email (double opt-in)")}
						checked={draft.double_opt_in}
						onCheckedChange={(checked) => {
							setDraft({ ...draft, double_opt_in: checked });
						}}
					/>
					<Checkbox
						label={t("Show as a popup")}
						checked={draft.popup.enabled}
						onCheckedChange={(checked) => {
							setDraft({ ...draft, popup: { ...draft.popup, enabled: checked } });
						}}
					/>
					{draft.popup.enabled && (
						<Input
							type="number"
							min={0}
							max={120}
							label={t("Open after (seconds)")}
							value={String(draft.popup.delay_seconds)}
							onChange={(event) => {
								setDraft({
									...draft,
									popup: {
										...draft.popup,
										delay_seconds: Math.max(0, Number(event.target.value) || 0),
									},
								});
							}}
						/>
					)}
					<details>
						<summary className="cursor-pointer text-sm font-medium">{t("More options")}</summary>
						<div className="mt-3 space-y-3">
							<Select
								label={t("Form language")}
								value={draft.locale}
								onValueChange={(next) => {
									if (next) setDraft({ ...draft, locale: next });
								}}
								items={{ en: t("English"), fr: t("French") }}
							/>
							<InputArea
								label={t("Description")}
								value={draft.description ?? ""}
								onChange={(event) => {
									setDraft({ ...draft, description: event.target.value || null });
								}}
							/>
							<Input
								label={t("Button label")}
								placeholder={t("Subscribe")}
								value={draft.submit_label}
								onChange={(event) => {
									setDraft({ ...draft, submit_label: event.target.value });
								}}
							/>
							<Input
								label={t("Success message")}
								placeholder={t("Thanks for subscribing!")}
								value={draft.success_message ?? ""}
								onChange={(event) => {
									setDraft({ ...draft, success_message: event.target.value || null });
								}}
							/>
							<Input
								type="url"
								label={t("Redirect to a page after signup")}
								value={draft.redirect_url ?? ""}
								onChange={(event) => {
									setDraft({ ...draft, redirect_url: event.target.value || null });
								}}
							/>
							<Checkbox
								label={t("Form is active")}
								checked={draft.status === "active"}
								onCheckedChange={(checked) => {
									setDraft({ ...draft, status: checked ? "active" : "disabled" });
								}}
							/>
						</div>
					</details>
					<div className="flex gap-2">
						<Button type="submit" variant="primary" disabled={busy || !draft.name.trim()}>
							{t(draft.id ? "Save" : "Create form")}
						</Button>
						<Button
							onClick={() => {
								setDraft(null);
							}}
						>
							{t("Cancel")}
						</Button>
					</div>
				</form>
			)}
			{embed && !draft && (
				<section className="space-y-4 rounded-lg border border-kumo-line bg-kumo-base p-5">
					<h2 className="font-semibold">
						{t("Add “{name}” to your website", { name: embed.form.name })}
					</h2>
					<Snippet
						label={t(embed.form.settings.popup.enabled ? "Popup script" : "Script (recommended)")}
						hint={t(
							"Paste where the form should appear. Changes you make here apply automatically.",
						)}
						value={embed.snippets.script_snippet}
						copied={copied}
						onCopy={copy}
					/>
					<Snippet
						label={t("HTML only")}
						hint={t("Works without JavaScript. Paste it again after changing the form.")}
						value={embed.snippets.html_snippet}
						copied={copied}
						onCopy={copy}
					/>
					<div className="space-y-1 text-sm">
						<p className="font-medium">{t("Hosted page")}</p>
						<a
							className="break-all underline"
							href={embed.snippets.hosted_url}
							target="_blank"
							rel="noreferrer"
						>
							{embed.snippets.hosted_url}
						</a>
					</div>
				</section>
			)}
		</div>
	);
}

function Snippet({
	label,
	hint,
	value,
	copied,
	onCopy,
}: {
	label: string;
	hint: string;
	value: string;
	copied: string;
	onCopy: (label: string, value: string) => Promise<void>;
}) {
	const { t } = useStudioI18n();
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<p className="text-sm font-medium">{label}</p>
				<Button size="sm" onClick={() => void onCopy(label, value)}>
					{t(copied === label ? "Copied" : "Copy")}
				</Button>
			</div>
			<p className="text-xs text-kumo-subtle">{hint}</p>
			<InputArea aria-label={label} readOnly value={value} rows={4} className="font-mono text-xs" />
		</div>
	);
}
