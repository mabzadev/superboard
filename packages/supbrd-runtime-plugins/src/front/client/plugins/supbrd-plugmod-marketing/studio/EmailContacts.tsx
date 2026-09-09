import { Button, Checkbox, Dialog, Input, Loader, Select } from "@superboard/front-ui/kumo";
import { useCallback, useEffect, useState, useRef } from "react";

import {
	createEmailSubscriber,
	getEmailSubscriberPage,
	importEmailSubscribers,
	exportEmailSubscribers,
	deleteEmailSubscriber,
	deleteSubscriberList,
	deleteSubscriberSegment,
	updateSubscriberList,
	updateSubscriberSegment,
	refreshSubscriberSegment,
	updateEmailSubscriber,
	getSubscriberLists,
	getSubscriberSegments,
	getEmailSubscriberExport,
	suppressEmailSubscriber,
	createSubscriberList,
	createSubscriberSegment,
	type EmailSubscriber,
	type SubscriberList,
	type SubscriberSegment,
	type SubscriberExport,
} from "../source/api/marketing/marketingService.js";
import { AudienceRules } from "./AudienceRules.js";
import { parseContactCsv } from "./contact-csv.js";
import { useStudioI18n } from "./i18n.js";

export function EmailContacts({
	project,
	locales = ["fr", "en"],
}: {
	project: string;
	locales?: string[];
}) {
	const { t, locale } = useStudioI18n();
	const languageNames = new Intl.DisplayNames([locale], { type: "language" });
	const [contacts, setContacts] = useState<EmailSubscriber[]>([]);
	const [lists, setLists] = useState<SubscriberList[]>([]);
	const [segments, setSegments] = useState<SubscriberSegment[]>([]);
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState("all");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [selected, setSelected] = useState<Partial<EmailSubscriber> | null>(null);
	const [activity, setActivity] = useState<SubscriberExport | null>(null);
	const [listName, setListName] = useState("");
	const [segment, setSegment] = useState({
		name: "",
		field: "locale",
		operator: "equals",
		value: "fr",
	});
	const [busy, setBusy] = useState(false);
	const [hasMore, setHasMore] = useState(false);
	const [editingList, setEditingList] = useState<string>();
	const [editingSegment, setEditingSegment] = useState<string>();
	const [segmentRules, setSegmentRules] = useState<Record<string, unknown>>({
		mode: "all",
		conditions: [{ field: "locale", operator: "equals", value: "fr" }],
	});
	const [importRows, setImportRows] = useState<Array<Record<string, unknown>>>([]);
	const [confirmation, setConfirmation] = useState<{
		name: string;
		action: () => Promise<unknown>;
	} | null>(null);
	const queryRef = useRef({ query, filter });
	queryRef.current = { query, filter };

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [people, groups, rules] = await Promise.all([
				getEmailSubscriberPage(
					project,
					queryRef.current.query,
					0,
					queryRef.current.filter === "all" ? "" : queryRef.current.filter,
				),
				getSubscriberLists(project),
				getSubscriberSegments(project),
			]);
			setContacts(people);
			setHasMore(people.length === 50);
			setLists(groups);
			setSegments(rules);
		} catch {
			setError(t("Loading failed"));
		} finally {
			setLoading(false);
		}
	}, [project, t]);
	useEffect(() => {
		const timer = setTimeout(() => void load(), 250);
		return () => clearTimeout(timer);
	}, [load, query, filter]);
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
	const attributes = selected?.attributes ?? {};
	const updatePreference = (key: string, value: string) =>
		setSelected((previous) => ({
			...previous,
			attributes: { ...previous?.attributes, [key]: value },
		}));
	const visible = contacts.filter(
		(contact) =>
			`${contact.email} ${contact.name ?? ""}`.toLowerCase().includes(query.toLowerCase()) &&
			(filter === "all" || contact.list_ids?.includes(filter)),
	);
	return (
		<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
			<section className="space-y-4">
				<div className="flex flex-wrap justify-between gap-3">
					<div className="flex gap-2">
						<Input
							placeholder={t("Search contacts")}
							aria-label={t("Search contacts")}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
						<Select
							aria-label={t("Lists")}
							value={filter}
							onValueChange={(value) => value && setFilter(value)}
							items={{
								all: t("All"),
								...Object.fromEntries(lists.map((list) => [list.id, list.name])),
							}}
						/>
					</div>
					<Button
						variant="primary"
						onClick={() => {
							setSelected({ email: "", name: "", attributes: {}, list_ids: [] });
							setActivity(null);
						}}
					>
						{t("Add contact")}
					</Button>
				</div>
				<div className="flex flex-wrap items-end gap-3">
					<Button
						onClick={async () => {
							try {
								const blob = await exportEmailSubscribers(project);
								const url = URL.createObjectURL(blob);
								const link = document.createElement("a");
								link.href = url;
								link.download = "contacts.csv";
								link.click();
								setTimeout(() => URL.revokeObjectURL(url), 1000);
							} catch {
								setError(t("Loading failed"));
							}
						}}
					>
						{t("Export CSV")}
					</Button>
					<Input
						type="file"
						accept=".csv,text/csv"
						label={t("Import CSV")}
						onChange={async (event) => {
							const file = event.target.files?.[0];
							if (!file) return;
							try {
								setImportRows(parseContactCsv(await file.text()));
								setError("");
							} catch {
								setError(t("Invalid CSV. Use an email column and at most 1000 contacts."));
							}
						}}
					/>
					{importRows.length > 0 && (
						<Button
							disabled={busy}
							onClick={() =>
								void run(async () => {
									await importEmailSubscribers(project, importRows);
									setImportRows([]);
								})
							}
						>
							{t("Import subscribed contacts")} ({importRows.length})
						</Button>
					)}
				</div>
				{error && (
					<p role="alert" className="text-kumo-danger">
						{error}
					</p>
				)}
				{loading ? (
					<Loader />
				) : (
					<div className="overflow-auto rounded-xl border border-kumo-line">
						<table className="w-full text-start text-sm">
							<thead className="bg-kumo-tint">
								<tr>
									{["Contact", "Language", "Status", "Lists"].map((label) => (
										<th key={label} className="p-4 text-start font-medium">
											{t(label)}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{visible.map((contact) => (
									<tr key={contact.id} className="border-t border-kumo-line">
										<td className="p-3">
											<Button
												variant="ghost"
												className="h-auto flex-col items-start"
												onClick={async () => {
													setSelected(contact);
													setActivity(null);
													try {
														setActivity(await getEmailSubscriberExport(project, contact.id));
													} catch {
														setError(t("Loading failed"));
													}
												}}
											>
												<span>{contact.name || contact.email}</span>
												<span className="mt-1 text-xs text-kumo-subtle">{contact.email}</span>
											</Button>
										</td>
										<td>{String(contact.attributes?.locale ?? "—")}</td>
										<td>{t(contact.consent_status ?? contact.status)}</td>
										<td>{contact.list_ids?.length ?? 0}</td>
									</tr>
								))}
							</tbody>
						</table>
						{!visible.length && <p className="p-6 text-kumo-subtle">{t("No matching contacts")}</p>}
					</div>
				)}
				{hasMore && (
					<Button
						disabled={busy}
						onClick={async () => {
							try {
								const next = await getEmailSubscriberPage(
									project,
									query,
									contacts.length,
									filter === "all" ? "" : filter,
								);
								setContacts((values) => [...values, ...next]);
								setHasMore(next.length === 50);
							} catch {
								setError(t("Loading failed"));
							}
						}}
					>
						{t("Load more")}
					</Button>
				)}
				<div className="grid gap-4 md:grid-cols-2">
					<div className="space-y-3 rounded-xl border border-kumo-line p-5">
						<h3 className="font-semibold">{t("Lists")}</h3>
						{lists.map((list) => (
							<p key={list.id} className="flex justify-between text-sm">
								<span>{list.name}</span>
								<span>
									{list.subscriber_count ?? 0}
									<Button
										size="xs"
										variant="ghost"
										onClick={() => {
											setListName(list.name);
											setEditingList(list.id);
										}}
									>
										{t("Edit")}
									</Button>
									<Button
										size="xs"
										variant="ghost"
										onClick={() =>
											setConfirmation({
												name: list.name,
												action: () => deleteSubscriberList(project, list.id),
											})
										}
									>
										{t("Delete")}
									</Button>
								</span>
							</p>
						))}
						<Input
							label={t("List name")}
							value={listName}
							onChange={(event) => setListName(event.target.value)}
						/>
						<Button
							disabled={!listName.trim() || busy}
							onClick={() =>
								void run(async () => {
									await (editingList
										? updateSubscriberList(project, editingList, { name: listName })
										: createSubscriberList(project, {
												name: listName,
												visibility: "private",
												optin_mode: "single",
											}));
									setEditingList(undefined);
									setListName("");
								})
							}
						>
							{t("Create list")}
						</Button>
					</div>
					<div className="space-y-3 rounded-xl border border-kumo-line p-5">
						<h3 className="font-semibold">{t("Segments")}</h3>
						{segments.map((item) => (
							<p key={item.id} className="flex justify-between text-sm">
								<span>{item.name}</span>
								<span>
									{item.subscriber_count ?? 0}
									<Button
										size="xs"
										variant="ghost"
										onClick={() => {
											const condition = (
												item.rules.conditions as Array<Record<string, unknown>> | undefined
											)?.[0];
											setSegment({
												name: item.name,
												field: String(condition?.field ?? "locale"),
												operator: String(condition?.operator ?? "equals"),
												value: String(condition?.value ?? ""),
											});
											setEditingSegment(item.id);
											setSegmentRules(structuredClone(item.rules));
										}}
									>
										{t("Edit")}
									</Button>
									<Button
										size="xs"
										variant="ghost"
										onClick={() => void run(() => refreshSubscriberSegment(project, item.id))}
									>
										{t("Refresh")}
									</Button>
									<Button
										size="xs"
										variant="ghost"
										onClick={() =>
											setConfirmation({
												name: item.name,
												action: () => deleteSubscriberSegment(project, item.id),
											})
										}
									>
										{t("Delete")}
									</Button>
								</span>
							</p>
						))}
						<Input
							label={t("Segment name")}
							value={segment.name}
							onChange={(event) => setSegment({ ...segment, name: event.target.value })}
						/>
						<AudienceRules value={segmentRules} onChange={setSegmentRules} />
						<Button
							disabled={!segment.name.trim() || busy}
							onClick={() =>
								void run(async () => {
									const payload = { name: segment.name, rules: segmentRules };
									if (editingSegment)
										await updateSubscriberSegment(project, editingSegment, payload);
									else await createSubscriberSegment(project, payload);
									setEditingSegment(undefined);
									setSegment({ ...segment, name: "" });
								})
							}
						>
							{t("Create segment")}
						</Button>
					</div>
				</div>
			</section>
			<Dialog.Root
				open={confirmation !== null}
				onOpenChange={(open) => {
					if (!open && !busy) setConfirmation(null);
				}}
			>
				<Dialog className="p-6">
					<Dialog.Title>
						{t("Delete")} · {confirmation?.name}
					</Dialog.Title>
					<Dialog.Description>{t("This item will be deleted.")}</Dialog.Description>
					{error && <p role="alert">{error}</p>}
					<div className="mt-5 flex justify-end gap-2">
						<Button disabled={busy} onClick={() => setConfirmation(null)}>
							{t("Cancel")}
						</Button>
						<Button
							variant="destructive"
							disabled={busy}
							onClick={async () => {
								if (!confirmation) return;
								setBusy(true);
								try {
									await confirmation.action();
									setConfirmation(null);
									await load();
								} catch {
									setError(t("Save failed"));
								} finally {
									setBusy(false);
								}
							}}
						>
							{t("Delete")}
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
			<aside className="space-y-4 rounded-xl border border-kumo-line bg-kumo-base p-5">
				{selected ? (
					<>
						<h2 className="text-lg font-semibold">{selected.name || t("Contact")}</h2>
						<Input
							label={t("Name")}
							value={selected.name ?? ""}
							onChange={(event) => setSelected({ ...selected, name: event.target.value })}
						/>
						<Input
							type="email"
							label={t("Email")}
							value={selected.email ?? ""}
							onChange={(event) => setSelected({ ...selected, email: event.target.value })}
						/>
						{(
							[
								["locale", "Preferred language"],
								["billing_locale", "Billing language"],
								["notification_locale", "Notification language"],
								["marketing_locale", "Marketing language"],
								["support_locale", "Support language"],
								["time_zone", "Time zone"],
							] as const
						).map(([key, label]) =>
							key === "time_zone" ? (
								<Input
									key={key}
									label={t(label)}
									value={String(attributes[key] ?? "")}
									onChange={(event) => updatePreference(key, event.target.value)}
								/>
							) : (
								<Select
									key={key}
									label={t(label)}
									value={String(attributes[key] ?? "")}
									onValueChange={(value) => updatePreference(key, value ?? "")}
									items={Object.fromEntries(
										[...new Set(["", ...locales, String(attributes[key] ?? "")])].map(
											(language) => {
												let name = language;
												try {
													name = language
														? (languageNames.of(language) ?? language)
														: t("Use account language");
												} catch {}
												return [language, name];
											},
										),
									)}
								/>
							),
						)}
						{lists.map((list) => (
							<Checkbox
								key={list.id}
								label={list.name}
								checked={selected.list_ids?.includes(list.id) ?? false}
								onCheckedChange={(checked) =>
									setSelected({
										...selected,
										list_ids: checked
											? [...(selected.list_ids ?? []), list.id]
											: selected.list_ids?.filter((id) => id !== list.id),
									})
								}
							/>
						))}
						<Button
							variant="primary"
							disabled={busy || !selected.email}
							onClick={() =>
								void run(async () => {
									const payload = {
										email: selected.email,
										name: selected.name,
										attributes: selected.attributes,
										list_ids: selected.list_ids,
									};
									const result = selected.id
										? await updateEmailSubscriber(project, selected.id, payload)
										: await createEmailSubscriber(project, payload);
									setSelected(result);
								})
							}
						>
							{t("Save")}
						</Button>
						{selected.id && (
							<Button
								variant="secondary-destructive"
								disabled={busy}
								onClick={() =>
									void run(async () => {
										setSelected(
											await suppressEmailSubscriber(project, selected.id!, "unsubscribe"),
										);
									})
								}
							>
								{t("Unsubscribe")}
							</Button>
						)}
						{selected.id && (
							<Button
								variant="secondary-destructive"
								disabled={busy}
								onClick={() =>
									setConfirmation({
										name: selected.email ?? "",
										action: async () => {
											await deleteEmailSubscriber(project, selected.id!);
											setSelected(null);
											setActivity(null);
										},
									})
								}
							>
								{t("Delete contact")}
							</Button>
						)}
						{activity && (
							<div className="space-y-3 border-t border-kumo-line pt-4">
								<h3 className="font-semibold">{t("Activity")}</h3>
								{activity.events.slice(0, 20).map((event, index) => (
									<div
										key={String(event.id ?? index)}
										className="rounded-lg bg-kumo-tint p-3 text-xs"
									>
										<p>{t(String(event.event_type ?? event.type ?? "Event"))}</p>
										<p className="mt-1 text-kumo-subtle">
											{String(event.occurred_at ?? event.created_at ?? "")}
										</p>
									</div>
								))}
							</div>
						)}
					</>
				) : (
					<p className="text-sm text-kumo-subtle">
						{t("Select a contact to view preferences and activity.")}
					</p>
				)}
			</aside>
		</div>
	);
}
