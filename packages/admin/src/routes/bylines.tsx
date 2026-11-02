import { Button, Input, InputArea, Loader, Select, Switch } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import * as React from "react";

import { BylineAvatarField } from "../components/BylineAvatarField.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { DialogError, getMutationError } from "../components/DialogError.js";
import { LocaleSwitcher, useI18nConfig } from "../components/LocaleSwitcher.js";
import { RouterLinkButton } from "../components/RouterLinkButton.js";
import { BYLINE_SCHEMA_NAV_ITEM } from "../components/Sidebar.js";
import { TranslationsPanel } from "../components/TranslationsPanel.js";
import {
	createByline,
	createBylineTranslation,
	deleteByline,
	fetchByline,
	fetchBylineTranslations,
	fetchBylines,
	fetchUsers,
	updateByline,
	type BylineSummary,
	type UserListItem,
} from "../lib/api";
import { listBylineFields, type BylineFieldDefinition } from "../lib/api/byline-fields.js";
import { fetchManifest } from "../lib/api/client.js";
import { useCurrentUser } from "../lib/api/current-user.js";
import { useDebouncedValue } from "../lib/hooks.js";

interface BylineFormState {
	slug: string;
	displayName: string;
	bio: string;
	websiteUrl: string;
	userId: string | null;
	isGuest: boolean;
	avatarMediaId: string | null;
	customFields: Record<string, unknown>;
}

export interface LoadMoreSnapshot {
	search: string;
	guestFilter: "all" | "guest" | "linked";
	locale: string | undefined;
	cursor: string;
}

export function loadMoreSnapshotMatches(
	snapshot: LoadMoreSnapshot,
	current: Omit<LoadMoreSnapshot, "cursor">,
): boolean {
	return (
		snapshot.search === current.search &&
		snapshot.guestFilter === current.guestFilter &&
		snapshot.locale === current.locale
	);
}

function toFormState(byline?: BylineSummary | null): BylineFormState {
	if (!byline) {
		return {
			slug: "",
			displayName: "",
			bio: "",
			websiteUrl: "",
			userId: null,
			isGuest: false,
			avatarMediaId: null,
			customFields: {},
		};
	}

	return {
		slug: byline.slug,
		displayName: byline.displayName,
		bio: byline.bio ?? "",
		websiteUrl: byline.websiteUrl ?? "",
		userId: byline.userId,
		isGuest: byline.isGuest,
		avatarMediaId: byline.avatarMediaId ?? null,
		customFields: byline.customFields ?? {},
	};
}

function getUserLabel(user: UserListItem): string {
	if (user.name) return `${user.name} (${user.email})`;
	return user.email;
}

export function BylinesPage() {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { locale: routeLocale } = useSearch({ from: "/_admin/bylines" });
	const [search, setSearch] = React.useState("");
	const debouncedSearch = useDebouncedValue(search, 300);
	const [guestFilter, setGuestFilter] = React.useState<"all" | "guest" | "linked">("all");
	const [selectedId, setSelectedId] = React.useState<string | null>(null);
	const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
	const [allItems, setAllItems] = React.useState<BylineSummary[]>([]);
	const [nextCursor, setNextCursor] = React.useState<string | undefined>(undefined);

	const { data: manifest } = useQuery({
		queryKey: ["manifest"],
		queryFn: fetchManifest,
	});
	const i18n = useI18nConfig(manifest);
	const isMultiLocale = !!i18n && i18n.locales.length > 1;

	const { data: currentUser } = useCurrentUser();
	const canManageBylineSchema = (currentUser?.role ?? 0) >= BYLINE_SCHEMA_NAV_ITEM.minRole;
	const activeLocale = routeLocale ?? i18n?.defaultLocale ?? undefined;

	const handleLocaleChange = (locale: string) => {
		void navigate({
			to: "/bylines",
			search: { locale: locale || undefined },
		});
		setSelectedId(null);
	};

	const { data, isLoading, error } = useQuery({
		queryKey: ["bylines", debouncedSearch, guestFilter, activeLocale ?? null],
		queryFn: () =>
			fetchBylines({
				search: debouncedSearch || undefined,
				isGuest: guestFilter === "all" ? undefined : guestFilter === "guest",
				locale: activeLocale,
				limit: 50,
			}),
		placeholderData: keepPreviousData,
	});

	React.useEffect(() => {
		if (data) {
			setAllItems(data.items);
			setNextCursor(data.nextCursor);
		}
	}, [data]);

	const { data: usersData } = useQuery({
		queryKey: ["users", "byline-linking"],
		queryFn: () => fetchUsers({ limit: 100 }),
	});

	const users = usersData?.items ?? [];

	const { data: customFieldsList, error: customFieldsError } = useQuery({
		queryKey: ["byline-fields"],
		queryFn: listBylineFields,
		staleTime: 60 * 1000,
	});
	const customFieldDefs = customFieldsList?.items ?? [];

	const loadMoreMutation = useMutation({
		mutationFn: async (snapshot: LoadMoreSnapshot) => {
			const result = await fetchBylines({
				search: snapshot.search || undefined,
				isGuest: snapshot.guestFilter === "all" ? undefined : snapshot.guestFilter === "guest",
				locale: snapshot.locale,
				limit: 50,
				cursor: snapshot.cursor,
			});
			return { result, snapshot };
		},
		onSuccess: ({ result, snapshot }) => {
			if (
				!loadMoreSnapshotMatches(snapshot, {
					search: debouncedSearch,
					guestFilter,
					locale: activeLocale,
				})
			) {
				return;
			}
			setAllItems((prev) => [...prev, ...result.items]);
			setNextCursor(result.nextCursor);
		},
	});

	const items = allItems;
	const { data: selectedRemote } = useQuery({
		queryKey: ["byline", selectedId],
		queryFn: () => (selectedId ? fetchByline(selectedId) : Promise.resolve(null)),
		enabled: !!selectedId,
	});
	const selected = selectedRemote ?? items.find((item) => item.id === selectedId) ?? null;

	const [form, setForm] = React.useState<BylineFormState>(() => toFormState(null));

	React.useEffect(() => {
		setForm(toFormState(selected));
	}, [selected]);

	const { data: translationsData } = useQuery({
		queryKey: ["byline-translations", selectedId],
		queryFn: () =>
			selectedId ? fetchBylineTranslations(selectedId) : Promise.resolve({ items: [] }),
		enabled: !!selectedId && isMultiLocale,
	});

	const createMutation = useMutation({
		mutationFn: () => {
			const body: Parameters<typeof createByline>[0] = {
				slug: form.slug,
				displayName: form.displayName,
				bio: form.bio || null,
				websiteUrl: form.websiteUrl || null,
				userId: form.userId,
				isGuest: form.isGuest,
				avatarMediaId: form.avatarMediaId,
				locale: activeLocale,
			};
			if (!customFieldsError && Object.keys(form.customFields).length > 0) {
				body.customFields = form.customFields;
			}
			return createByline(body);
		},
		onSuccess: (created) => {
			void queryClient.invalidateQueries({ queryKey: ["bylines"] });
			void queryClient.invalidateQueries({ queryKey: ["byline", created.id] });
			setSelectedId(created.id);
		},
	});

	const updateMutation = useMutation({
		mutationFn: () => {
			if (!selectedId) throw new Error("No byline selected");
			const body: Parameters<typeof updateByline>[1] = {
				slug: form.slug,
				displayName: form.displayName,
				bio: form.bio || null,
				websiteUrl: form.websiteUrl || null,
				userId: form.userId,
				isGuest: form.isGuest,
				avatarMediaId: form.avatarMediaId,
			};
			if (!customFieldsError) {
				body.customFields = form.customFields;
			}
			return updateByline(selectedId, body);
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["bylines"] });
			if (selectedId) {
				void queryClient.invalidateQueries({ queryKey: ["byline", selectedId] });
			}
		},
	});

	const deleteMutation = useMutation({
		mutationFn: () => {
			if (!selectedId) throw new Error("No byline selected");
			return deleteByline(selectedId);
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["bylines"] });
			setSelectedId(null);
			setShowDeleteConfirm(false);
		},
	});

	const [pendingTranslationLocale, setPendingTranslationLocale] = React.useState<string | null>(
		null,
	);
	const translateMutation = useMutation({
		mutationFn: (targetLocale: string) => {
			if (!selectedId) throw new Error("No byline selected");
			setPendingTranslationLocale(targetLocale);
			return createBylineTranslation(selectedId, { locale: targetLocale });
		},
		onSettled: () => {
			setPendingTranslationLocale(null);
		},
		onSuccess: (created) => {
			void queryClient.invalidateQueries({ queryKey: ["bylines"] });
			if (selectedId) {
				void queryClient.invalidateQueries({
					queryKey: ["byline-translations", selectedId],
				});
			}
			void navigate({
				to: "/bylines",
				search: { locale: created.locale },
			});
			setSelectedId(created.id);
		},
	});

	if (isLoading && !data) {
		return (
			<div className="flex items-center justify-center min-h-[30vh]">
				<Loader />
			</div>
		);
	}

	if (error) {
		return <div className="text-kumo-danger">{t`Failed to load bylines: ${error.message}`}</div>;
	}

	const isSaving = createMutation.isPending || updateMutation.isPending;
	const mutationError =
		createMutation.error || updateMutation.error || deleteMutation.error || translateMutation.error;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between gap-3">
				<h1 className="text-2xl font-semibold leading-tight">{t`Bylines`}</h1>
				<div className="flex items-center gap-2">
					{canManageBylineSchema && (
						<RouterLinkButton
							to={BYLINE_SCHEMA_NAV_ITEM.to}
							variant="secondary"
							icon={<BYLINE_SCHEMA_NAV_ITEM.icon />}
						>
							{t`Byline schema`}
						</RouterLinkButton>
					)}
					{isMultiLocale && i18n && activeLocale && (
						<LocaleSwitcher
							locales={i18n.locales}
							defaultLocale={i18n.defaultLocale}
							value={activeLocale}
							onChange={handleLocaleChange}
						/>
					)}
				</div>
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
				<div className="rounded-lg border p-4">
					<div className="mb-4 space-y-2">
						<Input
							placeholder={t`Search bylines`}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
						<div className="flex items-center gap-2">
							<div className="flex-1">
								<Select
									aria-label={t`Filter byline type`}
									value={guestFilter}
									onValueChange={(v) => setGuestFilter((v as "all" | "guest" | "linked") ?? "all")}
									items={{
										all: t`All bylines`,
										guest: t`Guest only`,
										linked: t`Linked only`,
									}}
									className="w-full"
								/>
							</div>
							<Button
								variant="secondary"
								onClick={() => {
									setSelectedId(null);
									setForm(toFormState(null));
								}}
							>
								{t`New`}
							</Button>
						</div>
					</div>

					<div className="space-y-2 max-h-[70vh] overflow-auto">
						{items.map((item) => {
							const active = item.id === selectedId;
							return (
								<button
									key={item.id}
									type="button"
									onClick={() => setSelectedId(item.id)}
									className={`w-full rounded border p-3 text-start ${
										active ? "border-kumo-brand bg-kumo-brand/10" : "border-kumo-line"
									}`}
								>
									<p className="font-medium">{item.displayName}</p>
									<p className="text-xs text-kumo-subtle">
										{item.slug}
										{item.isGuest ? t` - Guest` : item.userId ? t` - Linked` : ""}
									</p>
								</button>
							);
						})}
						{items.length === 0 && (
							<p className="text-sm text-kumo-subtle">{t`No bylines found`}</p>
						)}
						{nextCursor && (
							<Button
								variant="secondary"
								className="w-full mt-2"
								onClick={() =>
									loadMoreMutation.mutate({
										search: debouncedSearch,
										guestFilter,
										locale: activeLocale,
										cursor: nextCursor,
									})
								}
								disabled={loadMoreMutation.isPending}
							>
								{loadMoreMutation.isPending ? t`Loading...` : t`Load more`}
							</Button>
						)}
					</div>
				</div>

				<div className="rounded-lg border p-6 space-y-6">
					<h2 className="text-lg font-semibold">
						{selected ? t`Edit ${selected.displayName}` : t`Create byline`}
					</h2>

					<div className="space-y-4">
						<Input
							label={t`Display name`}
							value={form.displayName}
							onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
						/>
						<Input
							label={t`Slug`}
							value={form.slug}
							onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))}
						/>
						<Input
							label={t`Website URL`}
							value={form.websiteUrl}
							onChange={(e) => setForm((prev) => ({ ...prev, websiteUrl: e.target.value }))}
						/>
						<InputArea
							label={t`Bio`}
							value={form.bio}
							onChange={(e) => setForm((prev) => ({ ...prev, bio: e.target.value }))}
							rows={5}
						/>
						<BylineAvatarField
							value={form.avatarMediaId}
							onChange={(mediaId) => setForm((prev) => ({ ...prev, avatarMediaId: mediaId }))}
						/>
						<Select
							label={t`Linked user`}
							value={form.userId ?? ""}
							onValueChange={(v) => {
								const val = (v as string) || null;
								setForm((prev) => ({
									...prev,
									userId: val,
									isGuest: val ? false : prev.isGuest,
								}));
							}}
							items={{
								"": t`No linked user`,
								...Object.fromEntries(users.map((u) => [u.id, getUserLabel(u)])),
							}}
							className="w-full"
						/>
						{customFieldDefs.length > 0 &&
							customFieldDefs.map((field) => (
								<CustomFieldInput
									key={field.id}
									field={field}
									value={form.customFields[field.slug]}
									onChange={(next) =>
										setForm((prev) => ({
											...prev,
											customFields: {
												...prev.customFields,
												[field.slug]: next,
											},
										}))
									}
								/>
							))}
						{customFieldsError && (
							<div className="rounded-md border border-kumo-danger/40 bg-kumo-danger/5 p-3 text-sm">
								<p className="font-medium text-kumo-danger">{t`Couldn't load custom fields.`}</p>
								<p className="text-xs text-kumo-subtle mt-1">
									{t`You can still edit the fixed fields above. Saving will not touch any stored custom-field values.`}
								</p>
							</div>
						)}

						<Switch
							label={t`Guest byline`}
							checked={form.isGuest}
							onCheckedChange={(checked) =>
								setForm((prev) => ({
									...prev,
									isGuest: checked,
									userId: checked ? null : prev.userId,
								}))
							}
						/>

						<DialogError message={getMutationError(mutationError)} />

						<div className="flex gap-2 pt-2">
							<Button
								onClick={() => {
									if (selected) {
										updateMutation.mutate();
									} else {
										createMutation.mutate();
									}
								}}
								disabled={!form.displayName || !form.slug || isSaving}
							>
								{isSaving ? t`Saving...` : selected ? t`Save` : t`Create`}
							</Button>

							{selected && (
								<Button
									variant="destructive"
									onClick={() => setShowDeleteConfirm(true)}
									disabled={deleteMutation.isPending}
								>
									{t`Delete`}
								</Button>
							)}
						</div>
					</div>

					{selected && isMultiLocale && i18n ? (
						<div className="border-t pt-6">
							<TranslationsPanel
								locales={i18n.locales}
								defaultLocale={i18n.defaultLocale}
								currentLocale={selected.locale}
								translations={translationsData?.items ?? []}
								onOpen={(summary) => {
									void navigate({
										to: "/bylines",
										search: { locale: summary.locale },
									});
									setSelectedId(summary.id);
								}}
								onCreate={(locale) => translateMutation.mutate(locale)}
								pendingLocale={pendingTranslationLocale}
							/>
						</div>
					) : null}
				</div>
			</div>

			<ConfirmDialog
				open={showDeleteConfirm}
				onClose={() => {
					setShowDeleteConfirm(false);
					deleteMutation.reset();
				}}
				title={t`Delete Byline?`}
				description={t`This removes the byline profile. Content byline links are removed and lead pointers are cleared.`}
				confirmLabel={t`Delete`}
				pendingLabel={t`Deleting...`}
				isPending={deleteMutation.isPending}
				error={deleteMutation.error}
				onConfirm={() => deleteMutation.mutate()}
			/>
		</div>
	);
}

function CustomFieldInput({
	field,
	value,
	onChange,
}: {
	field: BylineFieldDefinition;
	value: unknown;
	onChange: (next: unknown) => void;
}) {
	const { t } = useLingui();
	const label = field.required ? `${field.label} *` : field.label;
	const stringValue = typeof value === "string" ? value : "";

	switch (field.type) {
		case "string":
			return (
				<Input
					label={label}
					value={stringValue}
					onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
				/>
			);
		case "text":
			return (
				<InputArea
					label={label}
					value={stringValue}
					onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
					rows={3}
				/>
			);
		case "url":
			return (
				<Input
					type="url"
					label={label}
					value={stringValue}
					onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
				/>
			);
		case "boolean":
			return (
				<Switch
					label={label}
					checked={value === true}
					onCheckedChange={(checked) => onChange(checked)}
				/>
			);
		case "select": {
			const options = field.validation?.options ?? [];
			const items: Record<string, string> = Object.create(null);
			items[""] = t`-- Select --`;
			for (const opt of options) items[opt] = opt;
			return (
				<Select
					label={label}
					value={stringValue}
					onValueChange={(v) => onChange(!v ? null : v)}
					items={items}
					className="w-full"
				/>
			);
		}
	}
}
