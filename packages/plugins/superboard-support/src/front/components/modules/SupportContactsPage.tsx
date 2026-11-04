"use client";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { ChevronRight } from "@superboard/front-ui/icons";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { usePathname, useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import { Switch } from "@superboard/front-ui/ui/switch.js";
import { Building2, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
	createSupportCompany,
	createSupportContact,
	createSupportContactNote,
	deleteSupportContactNote,
	getSupportCompanies,
	getSupportContact,
	getSupportContactNotes,
	getSupportContacts,
	updateSupportContact,
	type SupportCompany,
	type SupportContact,
	type SupportContactDetail,
	type SupportContactNote,
} from "../../api/support/operationsService.js";
import { useSupportI18n } from "../../i18n.js";
import { SupportSection } from "../support/SupportUi.js";

type Draft = {
	external_user_id: string;
	name: string;
	email: string;
	phone: string;
	company_id: string;
	blocked: boolean;
	custom_attributes: Array<{ id: string; key: string; value: string }>;
};
const NEW_CONTACT = "new";
const emptyDraft: Draft = {
	external_user_id: "",
	name: "",
	email: "",
	phone: "",
	company_id: "",
	blocked: false,
	custom_attributes: [],
};

export default function SupportContactsPage({ embedded = false }: { embedded?: boolean } = {}) {
	const { t, locale } = useSupportI18n();
	const router = useRouter();
	const pathname = usePathname();
	const search = useSearchParams();
	const requested = search.get("contact");
	const selectedId = requested && requested !== NEW_CONTACT ? requested : null;
	const { selectedProject } = useProjectSelection();
	const projectId = selectedProject?.id;
	const [contacts, setContacts] = useState<SupportContact[]>([]);
	const [companies, setCompanies] = useState<SupportCompany[]>([]);
	const [notes, setNotes] = useState<SupportContactNote[]>([]);
	const [conversations, setConversations] = useState<SupportContactDetail["conversations"]>([]);
	const [draft, setDraft] = useState<Draft>(emptyDraft);
	const [query, setQuery] = useState("");
	const [note, setNote] = useState("");
	const [companyName, setCompanyName] = useState("");
	const [companyDomain, setCompanyDomain] = useState("");
	const [busy, setBusy] = useState(false);

	const load = useCallback(
		async (search: string) => {
			if (!projectId) return;
			setBusy(true);
			try {
				const [result, companyResult] = await Promise.all([
					getSupportContacts(projectId, search.trim()),
					getSupportCompanies(projectId),
				]);
				setContacts(result.data || []);
				setCompanies(companyResult.data || []);
			} catch (error) {
				showErrorNotification(
					error instanceof Error ? error.message : t("Unable to load contacts"),
				);
			} finally {
				setBusy(false);
			}
		},
		[projectId, t],
	);

	useEffect(() => {
		void load("");
	}, [load]);
	useEffect(() => {
		if (!projectId || !selectedId) {
			setNotes([]);
			setConversations([]);
			setDraft(emptyDraft);
			return;
		}
		let active = true;
		void Promise.all([
			getSupportContactNotes(projectId, selectedId),
			getSupportContact(projectId, selectedId),
		])
			.then(([noteResult, contactResult]) => {
				if (!active) return;
				setNotes(noteResult.data || []);
				setConversations(contactResult.data.conversations || []);
				setDraft((current) =>
					current.external_user_id ? current : contactDraft(contactResult.data),
				);
			})
			.catch((error) =>
				showErrorNotification(
					error instanceof Error ? error.message : t("Unable to load contact details"),
				),
			);
		return () => {
			active = false;
		};
	}, [projectId, selectedId, t]);

	const showContact = (contactId: string | null) => {
		const next = new URLSearchParams(search);
		if (contactId) next.set("contact", contactId);
		else next.delete("contact");
		const value = next.toString();
		router.push(value ? `${pathname}?${value}` : pathname);
	};
	const select = (contact: SupportContact) => {
		setDraft(contactDraft(contact));
		showContact(contact.id);
	};

	const save = async () => {
		if (!projectId) return;
		setBusy(true);
		try {
			const customAttributes = Object.fromEntries(
				draft.custom_attributes
					.filter((attribute) => attribute.key.trim())
					.map((attribute) => [attribute.key.trim(), attribute.value]),
			);
			const payload = {
				external_user_id: draft.external_user_id.trim(),
				name: draft.name.trim() || null,
				email: draft.email.trim() || null,
				phone: draft.phone.trim() || null,
				company_id: draft.company_id.trim() || null,
				blocked: draft.blocked,
				custom_attributes: customAttributes,
			};
			if (selectedId) await updateSupportContact(projectId, selectedId, payload);
			else await createSupportContact(projectId, payload);
			showSuccessNotification(t("Contact saved"));
			await load(query);
			showContact(null);
		} catch (error) {
			showErrorNotification(error instanceof Error ? error.message : t("Unable to save contact"));
		} finally {
			setBusy(false);
		}
	};

	const addNote = async () => {
		if (!projectId || !selectedId || !note.trim()) return;
		try {
			await createSupportContactNote(projectId, selectedId, note.trim());
			setNote("");
			setNotes((await getSupportContactNotes(projectId, selectedId)).data || []);
		} catch (error) {
			showErrorNotification(error instanceof Error ? error.message : t("Unable to add note"));
		}
	};

	const removeNote = async (noteId: string) => {
		if (!projectId || !selectedId) return;
		try {
			await deleteSupportContactNote(projectId, selectedId, noteId);
			setNotes((current) => current.filter((item) => item.id !== noteId));
		} catch (error) {
			showErrorNotification(error instanceof Error ? error.message : t("Unable to delete note"));
		}
	};

	const addCompany = async () => {
		if (!projectId || !companyName.trim()) return;
		setBusy(true);
		try {
			await createSupportCompany(projectId, {
				name: companyName.trim(),
				domain: companyDomain.trim() || null,
				description: null,
				custom_attributes: {},
			});
			setCompanyName("");
			setCompanyDomain("");
			showSuccessNotification(t("Company created"));
			await load(query);
		} catch (error) {
			showErrorNotification(error instanceof Error ? error.message : t("Unable to create company"));
		} finally {
			setBusy(false);
		}
	};

	const dateTime = (value: string) => new Date(value).toLocaleString(locale);
	const editAttribute = (id: string, change: Partial<Draft["custom_attributes"][number]>) =>
		setDraft({
			...draft,
			custom_attributes: draft.custom_attributes.map((item) =>
				item.id === id ? { ...item, ...change } : item,
			),
		});

	if (requested)
		return (
			<div className={embedded ? "max-w-3xl space-y-6" : "max-w-3xl space-y-6 p-6"}>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						showContact(null);
					}}
				>
					<ChevronRight className="-scale-x-100 rtl:scale-x-100" />
					{t("All contacts")}
				</Button>
				<div className="space-y-4">
					<div>
						<h2 className="text-xl font-semibold">
							{selectedId ? t("Edit contact") : t("New contact")}
						</h2>
						<p className="text-sm text-muted-foreground">
							{t("The customer ID comes from the existing application identity.")}
						</p>
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						<Field
							id="contact-customer-id"
							label={t("Customer ID")}
							value={draft.external_user_id}
							onChange={(value) => setDraft({ ...draft, external_user_id: value })}
						/>
						<Field
							id="contact-name"
							label={t("Name")}
							value={draft.name}
							onChange={(value) => setDraft({ ...draft, name: value })}
						/>
						<Field
							id="contact-email"
							label={t("Email")}
							type="email"
							value={draft.email}
							onChange={(value) => setDraft({ ...draft, email: value })}
						/>
						<Field
							id="contact-phone"
							label={t("Phone")}
							value={draft.phone}
							onChange={(value) => setDraft({ ...draft, phone: value })}
						/>
						<div className="space-y-2">
							<Label htmlFor="contact-company">{t("Company")}</Label>
							<select
								id="contact-company"
								className="w-full rounded-md border bg-background px-3 py-2 text-sm"
								value={draft.company_id}
								onChange={(event) => setDraft({ ...draft, company_id: event.target.value })}
							>
								<option value="">{t("No company")}</option>
								{companies.map((company) => (
									<option key={company.id} value={company.id}>
										{company.name}
									</option>
								))}
							</select>
						</div>
						<div className="flex items-center justify-between rounded-md border px-3">
							<Label htmlFor="contact-blocked">{t("Blocked")}</Label>
							<Switch
								id="contact-blocked"
								checked={draft.blocked}
								onCheckedChange={(blocked) => setDraft({ ...draft, blocked })}
							/>
						</div>
					</div>
					<div className="space-y-3">
						<div className="flex items-center justify-between gap-3">
							<Label>{t("Custom attributes")}</Label>
							<Button
								size="sm"
								type="button"
								variant="outline"
								onClick={() =>
									setDraft({
										...draft,
										custom_attributes: [
											...draft.custom_attributes,
											{ id: crypto.randomUUID(), key: "", value: "" },
										],
									})
								}
							>
								<Plus className="h-4 w-4" />
								{t("Add attribute")}
							</Button>
						</div>
						{draft.custom_attributes.length === 0 ? (
							<p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
								{t("No custom attributes on this contact.")}
							</p>
						) : (
							draft.custom_attributes.map((attribute, index) => (
								<div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]" key={attribute.id}>
									<Input
										aria-label={t("Attribute {index} name", { index: index + 1 })}
										placeholder={t("Attribute name")}
										value={attribute.key}
										onChange={(event) => {
											editAttribute(attribute.id, { key: event.target.value });
										}}
									/>
									<Input
										aria-label={t("Attribute {index} value", { index: index + 1 })}
										placeholder={t("Value")}
										value={attribute.value}
										onChange={(event) => {
											editAttribute(attribute.id, { value: event.target.value });
										}}
									/>
									<Button
										aria-label={t("Remove attribute {index}", { index: index + 1 })}
										size="icon"
										type="button"
										variant="ghost"
										onClick={() =>
											setDraft({
												...draft,
												custom_attributes: draft.custom_attributes.filter(
													(item) => item.id !== attribute.id,
												),
											})
										}
									>
										<Trash2 />
									</Button>
								</div>
							))
						)}
					</div>
					<div className="flex justify-end">
						<Button disabled={busy || !draft.external_user_id.trim()} onClick={() => void save()}>
							<Save className="h-4 w-4" />
							{t("Save contact")}
						</Button>
					</div>
				</div>
				{selectedId && (
					<SupportSection title={t("Private contact notes")}>
						<p className="text-sm text-muted-foreground">
							{t("Notes are visible only to dashboard operators.")}
						</p>
						<div className="flex gap-2">
							<Input
								value={note}
								maxLength={8000}
								placeholder={t("Add context for the support team")}
								onChange={(event) => setNote(event.target.value)}
							/>
							<Button disabled={!note.trim()} onClick={() => void addNote()}>
								{t("Add note")}
							</Button>
						</div>
						<div className="space-y-2">
							{notes.map((item) => (
								<div
									key={item.id}
									className="flex items-start justify-between gap-3 rounded-md border p-3"
								>
									<div>
										<p className="whitespace-pre-wrap text-sm">{item.content}</p>
										<p className="mt-1 text-xs text-muted-foreground">
											{item.created_by} · {dateTime(item.created_at)}
										</p>
									</div>
									<Button
										size="icon"
										variant="ghost"
										aria-label={t("Delete note")}
										onClick={() => void removeNote(item.id)}
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</div>
							))}
						</div>
					</SupportSection>
				)}
				{selectedId && (
					<SupportSection title={t("Conversation history")}>
						<p className="text-sm text-muted-foreground">
							{t("Recent Support conversations for this customer identity.")}
						</p>
						<div className="space-y-2">
							{conversations.length === 0 ? (
								<p className="text-sm text-muted-foreground">{t("No conversations yet.")}</p>
							) : (
								conversations.map((conversation) => (
									<div
										key={conversation.id}
										className="flex items-center justify-between rounded-md border p-3"
									>
										<div>
											<p className="font-medium">
												{conversation.subject || t("Support conversation")}
											</p>
											<p className="text-xs text-muted-foreground">
												{t("{priority} priority", { priority: conversation.priority })} ·{" "}
												{dateTime(conversation.updated_at)}
											</p>
										</div>
										<Badge variant="outline">{conversation.status}</Badge>
									</div>
								))
							)}
						</div>
					</SupportSection>
				)}
			</div>
		);

	return (
		<div className={embedded ? "space-y-5" : "space-y-5 p-6"}>
			{!embedded && (
				<div>
					<h1 className="text-2xl font-semibold">{t("Contacts")}</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"Customer profiles, companies, custom attributes, conversation history, and private notes.",
						)}
					</p>
				</div>
			)}
			<SectionNavigation />
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative min-w-[240px] flex-1">
					<Search className="absolute start-3 top-2.5 h-4 w-4 text-muted-foreground" />
					<Input
						type="search"
						className="ps-9"
						aria-label={t("Search name, email, phone, or customer ID")}
						placeholder={t("Search name, email, phone, or customer ID")}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") void load(query);
						}}
					/>
				</div>
				<Button variant="outline" disabled={busy} onClick={() => void load(query)}>
					<RefreshCw className="h-4 w-4" />
					{t("Search")}
				</Button>
				<Button
					onClick={() => {
						showContact(NEW_CONTACT);
					}}
				>
					<Plus className="h-4 w-4" />
					{t("New contact")}
				</Button>
			</div>
			<div className="divide-y rounded-md border">
				{contacts.map((contact) => (
					<button
						key={contact.id}
						type="button"
						className="w-full p-4 text-start hover:bg-muted"
						onClick={() => select(contact)}
					>
						<div className="flex items-center justify-between gap-2">
							<span className="truncate font-medium">
								{contact.name || contact.external_user_id}
							</span>
							{contact.blocked && <Badge variant="destructive">{t("Blocked")}</Badge>}
						</div>
						<p className="mt-1 truncate text-xs text-muted-foreground">
							{contact.email || contact.phone || contact.external_user_id}
							{" · "}
							{t("{count} conversations", { count: contact.conversation_count || 0 })}
							{contact.company_name ? ` · ${contact.company_name}` : ""}
						</p>
					</button>
				))}
				{!contacts.length && (
					<p className="p-10 text-center text-sm text-muted-foreground">
						{t("No contacts match this search.")}
					</p>
				)}
			</div>
			<SupportSection icon={<Building2 className="h-4 w-4" />} title={t("Companies")}>
				<p className="text-sm text-muted-foreground">
					{t("Create reusable company records, then choose one in a contact’s form.")}
				</p>
				<div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
					<Input
						aria-label={t("Company name")}
						placeholder={t("Company name")}
						value={companyName}
						onChange={(event) => setCompanyName(event.target.value)}
					/>
					<Input
						aria-label={t("Domain (optional)")}
						placeholder={t("Domain (optional)")}
						value={companyDomain}
						onChange={(event) => setCompanyDomain(event.target.value)}
					/>
					<Button disabled={busy || !companyName.trim()} onClick={() => void addCompany()}>
						<Plus className="h-4 w-4" />
						{t("Create company")}
					</Button>
				</div>
				{companies.length > 0 && (
					<div className="divide-y rounded-md border">
						{companies.map((company) => (
							<div key={company.id} className="p-3">
								<p className="font-medium">{company.name}</p>
								<p className="text-xs text-muted-foreground">
									{company.domain || t("No domain")} ·{" "}
									{t("{count} contacts", { count: company.contact_count || 0 })}
								</p>
							</div>
						))}
					</div>
				)}
			</SupportSection>
		</div>
	);
}

function contactDraft(contact: SupportContact): Draft {
	return {
		external_user_id: contact.external_user_id,
		name: contact.name || "",
		email: contact.email || "",
		phone: contact.phone || "",
		company_id: contact.company_id || "",
		blocked: contact.blocked,
		custom_attributes: Object.entries(contact.custom_attributes || {}).map(([key, value]) => ({
			id: crypto.randomUUID(),
			key,
			value: value == null ? "" : String(value),
		})),
	};
}

function Field({
	id,
	label,
	value,
	onChange,
	type = "text",
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	type?: string;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
		</div>
	);
}
