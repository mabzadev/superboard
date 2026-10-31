import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { Button, Dialog, Input, Loader, Select } from "@superboard/front-ui/kumo";
import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import {
	Table as FrontTable,
	TableHeader as FrontTableHeader,
	TableBody as FrontTableBody,
	TableRow as FrontTableRow,
	TableHead as FrontTableHead,
	TableCell as FrontTableCell,
} from "@superboard/front-ui/ui/table.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { EmptyState } from "@superboard/front-ui/ui/widgets.js";
import { useCallback, useEffect, useState } from "react";

import {
	createEmailSuppression,
	createSubscriberList,
	createSubscriberSegment,
	deleteEmailSuppression,
	deleteSubscriberList,
	deleteSubscriberSegment,
	getEmailCampaigns,
	getEmailSuppressions,
	getSubscriberLists,
	getSubscriberSegments,
	refreshSubscriberSegment,
	updateSubscriberList,
	updateSubscriberSegment,
	type EmailSuppression,
	type SubscriberList,
	type SubscriberSegment,
} from "../api/marketing/marketingService.js";
import { getAudienceFields, getAudienceTags } from "./audience-service.js";
import { AudienceFields } from "./AudienceFields.js";
import { AudienceForms } from "./AudienceForms.js";
import { AudienceRules } from "./AudienceRules.js";
import { DoubleOptInEmail } from "./DoubleOptInEmail.js";
import { EmailContacts } from "./EmailContacts.js";
import { useStudioI18n } from "./i18n.js";
import { getStudioSettings } from "./service.js";
import { useWorkspaceTab } from "./workspace-navigation.js";

const tabs = {
	contacts: "Contacts",
	lists: "Lists",
	segments: "Segments",
	fields: "Fields & tags",
	forms: "Forms",
	suppressions: "Suppressions",
};

export function AudiencePage({ tab, fallback }: { tab: string; fallback: string }) {
	const { t } = useStudioI18n();
	const { selectedProject } = useProjectSelection();
	const { open } = useWorkspaceTab(fallback);
	const [locales, setLocales] = useState<string[]>();
	const project = selectedProject?.id;
	useEffect(() => {
		if (!project) return;
		let active = true;
		void getStudioSettings(project).then(
			(settings) => {
				if (active) setLocales(settings.locales);
			},
			() => undefined,
		);
		return () => {
			active = false;
		};
	}, [project]);
	return (
		<section className="ds-page space-y-5">
			<header className="ds-page-header">
				<div>
					<h1 className="ds-page-title">{t("Audience")}</h1>
					<p className="ds-page-description">
						{t(
							"Contacts, lists, segments, signup forms and the addresses that must never receive email.",
						)}
					</p>
				</div>
			</header>
			<SectionNavigation />
			{project && (
				<Tabs
					value={tab}
					onValueChange={(value) => {
						void open(String(value)).catch(() => undefined);
					}}
				>
					<TabsList aria-label={t("Audience sections")} className="h-auto flex-wrap">
						{Object.entries(tabs).map(([value, label]) => (
							<TabsTrigger key={value} value={value}>
								{t(label)}
							</TabsTrigger>
						))}
					</TabsList>
					<TabsContent value="contacts">
						{tab === "contacts" && (
							<EmailContacts key={project} project={project} locales={locales} />
						)}
					</TabsContent>
					<TabsContent value="lists">
						{tab === "lists" && <AudienceLists key={project} project={project} />}
					</TabsContent>
					<TabsContent value="segments">
						{tab === "segments" && <AudienceSegments key={project} project={project} />}
					</TabsContent>
					<TabsContent value="fields">
						{tab === "fields" && <AudienceFields key={project} project={project} />}
					</TabsContent>
					<TabsContent value="forms">
						{tab === "forms" && <AudienceForms key={project} project={project} />}
					</TabsContent>
					<TabsContent value="suppressions">
						{tab === "suppressions" && <AudienceSuppressions key={project} project={project} />}
					</TabsContent>
				</Tabs>
			)}
		</section>
	);
}

function useCollection<T>(load: () => Promise<T[]>) {
	const { t, locale } = useStudioI18n();
	const [items, setItems] = useState<T[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const apply = useCallback((values: T[]) => {
		setItems(values);
		setError("");
		setLoading(false);
	}, []);
	const fail = useCallback(() => {
		setError(t("Loading failed"));
		setLoading(false);
	}, [t]);
	const reload = useCallback(() => load().then(apply, fail), [load, apply, fail]);
	useEffect(() => {
		let active = true;
		void load().then(
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
	}, [load, apply, fail]);
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
	return { items, loading, busy, error, run };
}

function ConfirmDelete({
	name,
	busy,
	onCancel,
	onConfirm,
}: {
	name: string | null;
	busy: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const { t } = useStudioI18n();
	return (
		<Dialog.Root
			open={name !== null}
			onOpenChange={(open) => {
				if (!open && !busy) onCancel();
			}}
		>
			<Dialog className="p-6">
				<Dialog.Title>
					{t("Delete")} · {name}
				</Dialog.Title>
				<Dialog.Description>{t("This item will be deleted.")}</Dialog.Description>
				<div className="mt-5 flex justify-end gap-2">
					<Button disabled={busy} onClick={onCancel}>
						{t("Cancel")}
					</Button>
					<Button variant="destructive" loading={busy} onClick={onConfirm}>
						{t("Delete")}
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}

type ListForm = {
	id?: string;
	name: string;
	description: string;
	visibility: string;
	optin_mode: string;
};
const emptyList: ListForm = {
	name: "",
	description: "",
	visibility: "private",
	optin_mode: "single",
};

function AudienceLists({ project }: { project: string }) {
	const { t } = useStudioI18n();
	const { items, loading, busy, error, run } = useCollection<SubscriberList>(
		useCallback(() => getSubscriberLists(project), [project]),
	);
	const [form, setForm] = useState<ListForm>(emptyList);
	const [deleting, setDeleting] = useState<SubscriberList | null>(null);
	if (loading) return <Loader />;
	return (
		<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
			<div className="space-y-3">
				{error && (
					<p role="alert" className="text-kumo-danger">
						{error}
					</p>
				)}
				{items.length ? (
					<div className="overflow-auto rounded-lg border border-kumo-line">
						<FrontTable className="w-full text-start text-sm">
							<FrontTableHeader className="bg-kumo-tint">
								<FrontTableRow>
									{["List", "Visibility", "Opt-in", "Contacts", "Actions"].map((label) => (
										<FrontTableHead key={label} className="p-4 text-start font-medium">
											{t(label)}
										</FrontTableHead>
									))}
								</FrontTableRow>
							</FrontTableHeader>
							<FrontTableBody>
								{items.map((list) => (
									<FrontTableRow key={list.id} className="border-t border-kumo-line">
										<FrontTableCell className="p-4">
											<p className="font-medium">{list.name}</p>
											{list.description && (
												<p className="mt-1 text-xs text-kumo-subtle">{list.description}</p>
											)}
										</FrontTableCell>
										<FrontTableCell>
											{t(list.visibility === "public" ? "Public" : "Private")}
										</FrontTableCell>
										<FrontTableCell>
											{t(list.optin_mode === "double" ? "Double opt-in" : "Single opt-in")}
										</FrontTableCell>
										<FrontTableCell>{list.subscriber_count ?? 0}</FrontTableCell>
										<FrontTableCell className="p-3">
											<div className="flex gap-2">
												<Button
													size="sm"
													onClick={() => {
														setForm({
															id: list.id,
															name: list.name,
															description: list.description ?? "",
															visibility: list.visibility,
															optin_mode: list.optin_mode,
														});
													}}
												>
													{t("Edit")}
												</Button>
												<Button
													size="sm"
													variant="ghost"
													onClick={() => {
														setDeleting(list);
													}}
												>
													{t("Delete")}
												</Button>
											</div>
										</FrontTableCell>
									</FrontTableRow>
								))}
							</FrontTableBody>
						</FrontTable>
					</div>
				) : (
					<EmptyState
						title={t("No lists yet")}
						description={t(
							"Lists group contacts who chose to hear from you. Create one with the form, then add contacts to it.",
						)}
					/>
				)}
			</div>
			<form
				className="space-y-3 rounded-lg border border-kumo-line bg-kumo-base p-5"
				onSubmit={(event) => {
					event.preventDefault();
					const payload = {
						name: form.name.trim(),
						description: form.description.trim() || null,
						visibility: form.visibility,
						optin_mode: form.optin_mode,
					};
					void run(() =>
						form.id
							? updateSubscriberList(project, form.id, payload)
							: createSubscriberList(project, payload),
					)
						.then((saved) => {
							if (saved) setForm(emptyList);
						})
						.catch(() => undefined);
				}}
			>
				<h2 className="font-semibold">{t(form.id ? "Edit list" : "Create list")}</h2>
				<Input
					label={t("List name")}
					value={form.name}
					required
					onChange={(event) => {
						setForm({ ...form, name: event.target.value });
					}}
				/>
				<Input
					label={t("Description")}
					value={form.description}
					onChange={(event) => {
						setForm({ ...form, description: event.target.value });
					}}
				/>
				<Select
					label={t("Visibility")}
					value={form.visibility}
					onValueChange={(value) => {
						if (value) setForm({ ...form, visibility: value });
					}}
					items={{
						private: t("Private: managed by your team"),
						public: t("Public: contacts can choose it in their preferences"),
					}}
				/>
				<Select
					label={t("Opt-in")}
					value={form.optin_mode}
					onValueChange={(value) => {
						if (value) setForm({ ...form, optin_mode: value });
					}}
					items={{
						single: t("Single opt-in"),
						double: t("Double opt-in: contacts confirm by email"),
					}}
				/>
				<div className="flex gap-2">
					<Button type="submit" variant="primary" disabled={busy || !form.name.trim()}>
						{t(form.id ? "Save" : "Create list")}
					</Button>
					{form.id && (
						<Button
							onClick={() => {
								setForm(emptyList);
							}}
						>
							{t("Cancel")}
						</Button>
					)}
				</div>
			</form>
			<DoubleOptInEmail project={project} />
			<ConfirmDelete
				name={deleting?.name ?? null}
				busy={busy}
				onCancel={() => {
					setDeleting(null);
				}}
				onConfirm={() => {
					if (!deleting) return;
					void run(() => deleteSubscriberList(project, deleting.id))
						.then(() => {
							setDeleting(null);
						})
						.catch(() => undefined);
				}}
			/>
		</div>
	);
}

const defaultRules = {
	mode: "all",
	conditions: [{ field: "locale", operator: "equals", value: "fr" }],
};

function AudienceSegments({ project }: { project: string }) {
	const { t } = useStudioI18n();
	const { items, loading, busy, error, run } = useCollection<SubscriberSegment>(
		useCallback(() => getSubscriberSegments(project), [project]),
	);
	const [editing, setEditing] = useState<string>();
	const [name, setName] = useState("");
	const [rules, setRules] = useState<Record<string, unknown>>(defaultRules);
	const [deleting, setDeleting] = useState<SubscriberSegment | null>(null);
	const [options, setOptions] = useState<{
		tags: Array<{ id: string; name: string }>;
		lists: Array<{ id: string; name: string }>;
		campaigns: Array<{ id: string; name: string }>;
		fieldKeys: string[];
	}>({ tags: [], lists: [], campaigns: [], fieldKeys: [] });
	useEffect(() => {
		let active = true;
		// Each source is optional: the editor keeps working with whatever loads.
		void Promise.allSettled([
			getAudienceTags(project),
			getSubscriberLists(project),
			getEmailCampaigns(project),
			getAudienceFields(project),
		])
			.then(([tags, lists, campaigns, fields]) => {
				if (!active) return;
				const value = <T,>(result: PromiseSettledResult<T[]>) =>
					result.status === "fulfilled" && Array.isArray(result.value) ? result.value : [];
				setOptions({
					tags: value(tags),
					lists: value(lists),
					campaigns: value(campaigns).map((campaign) => ({
						id: String(campaign.id),
						name: String(campaign.name ?? campaign.id),
					})),
					fieldKeys: value(fields).map((field) => field.key),
				});
			})
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, [project]);
	if (loading) return <Loader />;
	return (
		<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
			<div className="space-y-3">
				{error && (
					<p role="alert" className="text-kumo-danger">
						{error}
					</p>
				)}
				{items.length ? (
					items.map((item) => (
						<div
							key={item.id}
							className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-kumo-line p-4"
						>
							<div>
								<p className="font-medium">{item.name}</p>
								<p className="text-xs text-kumo-subtle">
									{t("{count} contacts", { count: item.subscriber_count ?? 0 })}
								</p>
							</div>
							<div className="flex gap-2">
								<Button
									size="sm"
									onClick={() => {
										setEditing(item.id);
										setName(item.name);
										setRules(structuredClone(item.rules));
									}}
								>
									{t("Edit")}
								</Button>
								<Button
									size="sm"
									disabled={busy}
									onClick={() => void run(() => refreshSubscriberSegment(project, item.id))}
								>
									{t("Refresh")}
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => {
										setDeleting(item);
									}}
								>
									{t("Delete")}
								</Button>
							</div>
						</div>
					))
				) : (
					<EmptyState
						title={t("No segments yet")}
						description={t(
							"Segments select contacts by profile, tags, lists or email activity. They update automatically before every send.",
						)}
					/>
				)}
			</div>
			<form
				className="space-y-3 rounded-lg border border-kumo-line bg-kumo-base p-5"
				onSubmit={(event) => {
					event.preventDefault();
					const payload = { name: name.trim(), rules };
					void run(() =>
						editing
							? updateSubscriberSegment(project, editing, payload)
							: createSubscriberSegment(project, payload),
					)
						.then((saved) => {
							if (!saved) return;
							setEditing(undefined);
							setName("");
							setRules(defaultRules);
						})
						.catch(() => undefined);
				}}
			>
				<h2 className="font-semibold">{t(editing ? "Edit segment" : "Create segment")}</h2>
				<Input
					label={t("Segment name")}
					value={name}
					required
					onChange={(event) => {
						setName(event.target.value);
					}}
				/>
				<AudienceRules value={rules} onChange={setRules} project={project} {...options} />
				<div className="flex gap-2">
					<Button type="submit" variant="primary" disabled={busy || !name.trim()}>
						{t(editing ? "Save" : "Create segment")}
					</Button>
					{editing && (
						<Button
							onClick={() => {
								setEditing(undefined);
								setName("");
								setRules(defaultRules);
							}}
						>
							{t("Cancel")}
						</Button>
					)}
				</div>
			</form>
			<ConfirmDelete
				name={deleting?.name ?? null}
				busy={busy}
				onCancel={() => {
					setDeleting(null);
				}}
				onConfirm={() => {
					if (!deleting) return;
					void run(() => deleteSubscriberSegment(project, deleting.id))
						.then(() => {
							setDeleting(null);
						})
						.catch(() => undefined);
				}}
			/>
		</div>
	);
}

const reasons: Record<EmailSuppression["reason"], string> = {
	manual: "Blocked by your team",
	unsubscribe: "Unsubscribed",
	hard_bounce: "Hard bounce",
	complaint: "Spam complaint",
	privacy_delete: "Privacy deletion",
};

function AudienceSuppressions({ project }: { project: string }) {
	const { t, locale } = useStudioI18n();
	const [query, setQuery] = useState("");
	const [search, setSearch] = useState("");
	const { items, loading, busy, error, run } = useCollection<EmailSuppression>(
		useCallback(() => getEmailSuppressions(project, search), [project, search]),
	);
	const [email, setEmail] = useState("");
	useEffect(() => {
		const timer = setTimeout(() => {
			setSearch(query.trim());
		}, 250);
		return () => {
			clearTimeout(timer);
		};
	}, [query]);
	return (
		<div className="space-y-4">
			<p className="text-sm text-kumo-subtle">
				{t(
					"Suppressed addresses never receive campaigns or automated emails. Unsubscribes, bounces and complaints are recorded automatically and can only be lifted by the contact.",
				)}
			</p>
			<div className="flex flex-wrap items-end justify-between gap-3">
				<Input
					aria-label={t("Search suppressions")}
					placeholder={t("Search suppressions")}
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
					}}
				/>
				<form
					className="flex flex-wrap items-end gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						void run(() => createEmailSuppression(project, email.trim()))
							.then((saved) => {
								if (saved) setEmail("");
							})
							.catch(() => undefined);
					}}
				>
					<Input
						type="email"
						label={t("Block an address")}
						value={email}
						required
						onChange={(event) => {
							setEmail(event.target.value);
						}}
					/>
					<Button type="submit" variant="primary" disabled={busy || !email.trim()}>
						{t("Block address")}
					</Button>
				</form>
			</div>
			{error && (
				<p role="alert" className="text-kumo-danger">
					{error}
				</p>
			)}
			{loading ? (
				<Loader />
			) : items.length ? (
				<div className="overflow-auto rounded-lg border border-kumo-line">
					<FrontTable className="w-full text-start text-sm">
						<FrontTableHeader className="bg-kumo-tint">
							<FrontTableRow>
								{["Email", "Reason", "Since", "Actions"].map((label) => (
									<FrontTableHead key={label} className="p-4 text-start font-medium">
										{t(label)}
									</FrontTableHead>
								))}
							</FrontTableRow>
						</FrontTableHeader>
						<FrontTableBody>
							{items.map((item) => (
								<FrontTableRow key={item.id} className="border-t border-kumo-line">
									<FrontTableCell className="p-4">{item.email}</FrontTableCell>
									<FrontTableCell>{t(reasons[item.reason] ?? item.reason)}</FrontTableCell>
									<FrontTableCell>
										{new Date(item.created_at).toLocaleDateString(locale)}
									</FrontTableCell>
									<FrontTableCell className="p-3">
										{item.reason === "manual" && (
											<Button
												size="sm"
												disabled={busy}
												aria-label={t("Unblock {email}", { email: item.email })}
												onClick={() => void run(() => deleteEmailSuppression(project, item.id))}
											>
												{t("Unblock")}
											</Button>
										)}
									</FrontTableCell>
								</FrontTableRow>
							))}
						</FrontTableBody>
					</FrontTable>
				</div>
			) : (
				<EmptyState
					title={t(search ? "No matching addresses" : "No suppressed addresses")}
					description={t(
						"Addresses appear here when someone unsubscribes, bounces, complains or is blocked by your team.",
					)}
				/>
			)}
		</div>
	);
}
