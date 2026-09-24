"use client";

import AdsPlatformSelect from "@superboard/front-ui/common/ads-platform.js";
import CustomizeColumns from "@superboard/front-ui/common/customize-columns.js";
import { PaginationFooter } from "@superboard/front-ui/common/pagination-footer.js";
import { DateRangePicker } from "@superboard/front-ui/components/dateRangePicker/DateRangePicker.js";
import {
	adsFilterList,
	platformsFilterList,
} from "@superboard/front-ui/constants/FilterOptions.js";
import { ACTIVE, ARCHIVED } from "@superboard/front-ui/constants/OptionsConstants.js";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { useTableParams } from "@superboard/front-ui/hooks/useTableParams.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superboard/front-ui/ui/dialog.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superboard/front-ui/ui/select.js";
import { Switch } from "@superboard/front-ui/ui/switch.js";
import { Download, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
	createLink,
	deleteLink,
	getLinkCampaigns,
	getLinks,
	updateLink,
	type DynamicLink,
	type LinkCampaign,
} from "../../../api/dynamic-links/dynamicLinksService.js";
import { useUrlState } from "../../../hooks/useUrlState.js";
import { toLinkData, type LinkData } from "./linkAnalytics.js";
import LinksTable from "./LinksTable.js";
import { getLinksTableColumns } from "./LinksTableColumns.js";

type LinkForm = {
	id?: string;
	name: string;
	slug: string;
	destination: string;
	ios: string;
	android: string;
	web: string;
	desktop: string;
	campaignId: string;
	title: string;
	subtitle: string;
	imageUrl: string;
	tags: string;
	source: string;
	medium: string;
	trackingCampaign: string;
	active: boolean;
};

const emptyForm: LinkForm = {
	name: "",
	slug: "",
	destination: "",
	ios: "",
	android: "",
	web: "",
	desktop: "",
	campaignId: "",
	title: "",
	subtitle: "",
	imageUrl: "",
	tags: "",
	source: "",
	medium: "",
	trackingCampaign: "",
	active: true,
};

function toForm(link: DynamicLink): LinkForm {
	return {
		id: link.id,
		name: link.name,
		slug: link.slug,
		destination: link.destination_url,
		ios: link.destinations.ios ?? "",
		android: link.destinations.android ?? "",
		web: link.destinations.web ?? "",
		desktop: link.destinations.desktop ?? "",
		campaignId: link.campaign_id ?? "",
		title: link.title ?? "",
		subtitle: link.subtitle ?? "",
		imageUrl: link.image_url ?? "",
		tags: typeof link.utm.tags === "string" ? link.utm.tags : "",
		source: typeof link.utm.source === "string" ? link.utm.source : "",
		medium: typeof link.utm.medium === "string" ? link.utm.medium : "",
		trackingCampaign: typeof link.utm.campaign === "string" ? link.utm.campaign : "",
		active: link.active,
	};
}

function csvCell(value: unknown) {
	return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

import {
	AcquisitionPage as ModulePage,
	useAcquisitionSelection,
	useItemExitGuard,
} from "../../../../AcquisitionPage.js";
import { useFlowI18n } from "../../../../flows/features/flows/i18n.js";

export default function LinksPageContent({ campaignId }: { campaignId?: string }) {
	const { itemId, selectItem } = useAcquisitionSelection();
	const { tr } = useFlowI18n();
	const [section, setSection] = useState("Details");
	const { selectedProject } = useProjectSelection();
	const {
		page,
		setPage,
		rowsPerPage,
		setRowsPerPage,
		sort,
		setSort,
		searchTerm,
		setSearchTerm,
		dateRange,
		setDateRange,
		platform,
		setPlatform,
	} = useTableParams({ defaultSortKey: "updated_at" });
	const [status, setStatus] = useUrlState("status", ACTIVE);
	const [linkType, setLinkType] = useUrlState("type", "");
	const [links, setLinks] = useState<DynamicLink[]>([]);
	const [campaigns, setCampaigns] = useState<LinkCampaign[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const [form, setForm] = useState<LinkForm>(emptyForm);
	const [selectedColumns, setSelectedColumns] = useState([
		"ads_platform",
		"title",
		"tags",
		"views",
		"opens",
		"installs",
		"reinstalls",
		"reactivations",
		"app_opens",
		"user_referred",
		"time_spent",
		"revenue",
		"date",
	]);

	const load = useCallback(async () => {
		if (!selectedProject) return;
		setLoading(true);
		try {
			const [linkRows, campaignRows] = await Promise.all([
				getLinks(
					selectedProject.id,
					itemId ? "" : searchTerm,
					itemId ? undefined : status === ACTIVE,
					{
						from: itemId ? undefined : dateRange?.from?.toISOString().slice(0, 10),
						to: itemId ? undefined : dateRange?.to?.toISOString().slice(0, 10),
						platform: itemId ? undefined : platform || undefined,
					},
				),
				getLinkCampaigns(selectedProject.id),
			]);
			setLinks(linkRows);
			const selected = linkRows.find((link) => link.id === itemId);
			if (selected) setForm((current) => (current.id === itemId ? current : toForm(selected)));
			setCampaigns(campaignRows);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		} finally {
			setLoading(false);
		}
	}, [dateRange, platform, searchTerm, selectedProject, status, itemId]);

	useEffect(() => {
		void load();
	}, [load]);

	const filtered = useMemo(() => {
		const from = dateRange?.from?.getTime() ?? Number.NEGATIVE_INFINITY;
		const to = dateRange?.to?.getTime() ?? Number.POSITIVE_INFINITY;
		return links
			.filter((link) => !campaignId || link.campaign_id === campaignId)
			.filter((link) => {
				const created = Date.parse(link.created_at);
				return !Number.isFinite(created) || (created >= from && created <= to);
			})
			.filter(
				(link) =>
					!linkType ||
					(typeof link.utm.source === "string"
						? link.utm.source === linkType
						: linkType === "quick-link"),
			)
			.filter((link) => !platform || Boolean(link.destinations[platform]))
			.map(toLinkData)
			.sort((left, right) => {
				const keys: Record<string, keyof LinkData> = {
					name: "name",
					tags: "tags",
					views: "total_views",
					opens: "total_opens",
					installs: "total_installs",
					reinstalls: "total_reinstalls",
					reactivations: "total_reactivations",
					app_opens: "total_app_opens",
					user_referred: "total_user_referred",
					time_spent: "total_time_spent",
					revenue: "total_revenue",
					updated_at: "updated_at",
				};
				const key = keys[sort.sortKey] ?? "updated_at";
				const first = left[key];
				const second = right[key];
				const comparison =
					typeof first === "number" && typeof second === "number"
						? first - second
						: String(first).localeCompare(String(second));
				return sort.ascending ? comparison : -comparison;
			});
	}, [campaignId, dateRange?.from, dateRange?.to, linkType, links, platform, sort]);

	const pageCount = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
	const currentPage = Math.min(page, pageCount);
	const visible = filtered.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

	useEffect(() => {
		if (page > pageCount) setPage(pageCount);
	}, [page, pageCount, setPage]);

	const openCreate = () => {
		setForm({ ...emptyForm, campaignId: campaignId ?? "" });
		setDialogOpen(true);
	};

	const openEdit = useCallback(
		(row: LinkData) => {
			const link = links.find((item) => item.id === row.id);
			if (!link) return;
			setForm(toForm(link));
			setSection("Details");
			selectItem(link.id);
		},
		[links, selectItem],
	);

	const payload = () => ({
		slug: form.slug.trim(),
		name: form.name.trim() || form.slug.trim(),
		destination_url: form.destination.trim(),
		destinations: Object.fromEntries(
			Object.entries({
				ios: form.ios.trim(),
				android: form.android.trim(),
				web: form.web.trim(),
				desktop: form.desktop.trim(),
			}).filter(([, value]) => value),
		),
		campaign_id: form.campaignId || null,
		title: form.title.trim() || null,
		subtitle: form.subtitle.trim() || null,
		image_url: form.imageUrl.trim() || null,
		utm: {
			source: form.source.trim(),
			medium: form.medium.trim(),
			campaign: form.trackingCampaign.trim(),
			tags: form.tags.trim(),
		},
		active: form.active,
	});

	const save = async () => {
		if (!selectedProject || !form.slug.trim() || !form.destination.trim()) return;
		setSaving(true);
		try {
			if (form.id) {
				await updateLink(selectedProject.id, form.id, payload());
				showSuccessNotification("Link updated");
			} else {
				const created = await createLink(selectedProject.id, payload());
				setForm((current) => ({ ...current, id: created.id }));
				setSection("Details");
				selectItem(created.id);
				showSuccessNotification("Link created");
			}
			setDialogOpen(false);
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setSaving(false);
		}
	};

	const remove = async () => {
		if (!selectedProject || !form.id) return;
		setSaving(true);
		try {
			await deleteLink(selectedProject.id, form.id);
			selectItem("");
			setDialogOpen(false);
			showSuccessNotification("Link deleted");
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setSaving(false);
		}
	};

	const exportCsv = () => {
		const header = [
			"Title",
			"Slug",
			"Tags",
			"Views",
			"Opens",
			"Installs",
			"Reinstalls",
			"Reactivations",
			"App opens",
			"Users referred",
			"Time spent",
			"Revenue",
			"Date",
		];
		const rows = filtered.map((link) => [
			link.name,
			link.path,
			link.tags.join(";"),
			link.total_views,
			link.total_opens,
			link.total_installs,
			link.total_reinstalls,
			link.total_reactivations,
			link.total_app_opens,
			link.total_user_referred,
			link.total_time_spent,
			link.total_revenue,
			link.updated_at,
		]);
		const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
		const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = "dynamic-links.csv";
		anchor.click();
		URL.revokeObjectURL(url);
	};

	const columns = useMemo(
		() => getLinksTableColumns(sort, setSort, openEdit),
		[openEdit, sort, setSort],
	);

	const columnOptions = [
		{ label: "Tags", value: "tags" },
		{ label: "Views", value: "views" },
		{ label: "Opens", value: "opens" },
		{ label: "Installs", value: "installs" },
		{ label: "Reinstalls", value: "reinstalls" },
		{ label: "Reactivations", value: "reactivations" },
		{ label: "App opens", value: "app_opens" },
		{ label: "Users referred", value: "user_referred" },
		{ label: "Time spent", value: "time_spent" },
		{ label: "Revenue", value: "revenue" },
		{ label: "Date", value: "date" },
	];

	const selectedLink = links.find((link) => link.id === itemId);
	const linkDirty = Boolean(
		selectedLink &&
		form.id === itemId &&
		JSON.stringify(form) !== JSON.stringify(toForm(selectedLink)),
	);
	useItemExitGuard(linkDirty, tr("Discard unsaved changes?"), () => {
		if (selectedLink) setForm(toForm(selectedLink));
	});
	const campaign = campaigns?.find((item) => item.id === campaignId);
	const campaignMissing = Boolean(
		selectedProject && campaignId && campaigns && !loading && !error && !campaign,
	);

	return (
		<ModulePage
			title={
				itemId && form.id === itemId
					? form.name
					: campaignId
						? (campaign?.name ?? tr("Campaign links"))
						: tr("Dynamic links")
			}
			description={tr(
				"Create, route and measure links across every platform and acquisition source.",
			)}
			error={error ?? (campaignMissing ? "Campaign not found" : null)}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : itemId ? (
				<div className="space-y-5">
					<Button
						variant="outline"
						onClick={() => {
							if (linkDirty && !window.confirm(tr("Discard unsaved changes?"))) return;
							selectItem("");
						}}
					>
						{tr("Back to list")}
					</Button>
					{form.id === itemId ? (
						<>
							<nav className="flex flex-wrap gap-2">
								{["Details", "Destinations", "Social preview", "Tracking", "Results"].map((tab) => (
									<Button
										key={tab}
										variant={section === tab ? "secondary" : "ghost"}
										onClick={() => {
											setSection(tab);
										}}
									>
										{tr(tab)}
									</Button>
								))}
							</nav>
							<div className="grid gap-5 py-2 sm:grid-cols-2">
								<section hidden={section !== "Details"} className="space-y-3">
									<h3 className="text-sm font-semibold">{tr("Link details")}</h3>
									<Field
										label={tr("Name")}
										value={form.name}
										onChange={(name) => {
											setForm((v) => ({ ...v, name }));
										}}
									/>
									<Field
										label={tr("Slug")}
										value={form.slug}
										onChange={(slug) => {
											setForm((v) => ({
												...v,
												slug: slug.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
											}));
										}}
									/>
									<Field
										label={tr("Default destination")}
										type="url"
										value={form.destination}
										onChange={(destination) => {
											setForm((v) => ({ ...v, destination }));
										}}
									/>
									<label className="space-y-2 text-sm">
										<span>{tr("Campaign")}</span>
										<Select
											value={form.campaignId || "none"}
											onValueChange={(campaignId) => {
												setForm((v) => ({
													...v,
													campaignId: campaignId === "none" ? "" : campaignId,
												}));
											}}
										>
											<SelectTrigger>
												<SelectValue placeholder={tr("No campaign")} />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="none">{tr("No campaign")}</SelectItem>
												{campaigns?.map((campaign) => (
													<SelectItem key={campaign.id} value={campaign.id}>
														{campaign.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</label>
									<Field
										label={tr("Tags (comma separated)")}
										value={form.tags}
										onChange={(tags) => {
											setForm((v) => ({ ...v, tags }));
										}}
									/>
									<label className="flex items-center gap-3 text-sm">
										<Switch
											aria-label={tr("Active")}
											checked={form.active}
											onCheckedChange={(active) => setForm((v) => ({ ...v, active }))}
										/>{" "}
										{tr("Active")}
									</label>
								</section>
								<section hidden={section !== "Destinations"} className="space-y-3">
									<h3 className="text-sm font-semibold">{tr("Platform routing")}</h3>
									<Field
										label={tr("iOS destination")}
										type="url"
										value={form.ios}
										onChange={(ios) => {
											setForm((v) => ({ ...v, ios }));
										}}
									/>
									<Field
										label={tr("Android destination")}
										type="url"
										value={form.android}
										onChange={(android) => {
											setForm((v) => ({ ...v, android }));
										}}
									/>
									<Field
										label={tr("Web destination")}
										type="url"
										value={form.web}
										onChange={(web) => {
											setForm((v) => ({ ...v, web }));
										}}
									/>
									<Field
										label={tr("Desktop destination")}
										type="url"
										value={form.desktop}
										onChange={(desktop) => {
											setForm((v) => ({ ...v, desktop }));
										}}
									/>
								</section>
								<section hidden={section !== "Social preview"} className="space-y-3">
									<h3 className="text-sm font-semibold">{tr("Social preview")}</h3>
									<Field
										label={tr("Title")}
										value={form.title}
										onChange={(title) => {
											setForm((v) => ({ ...v, title }));
										}}
									/>
									<Field
										label={tr("Description")}
										value={form.subtitle}
										onChange={(subtitle) => {
											setForm((v) => ({ ...v, subtitle }));
										}}
									/>
									<Field
										label={tr("Image URL")}
										type="url"
										value={form.imageUrl}
										onChange={(imageUrl) => {
											setForm((v) => ({ ...v, imageUrl }));
										}}
									/>
								</section>
								<section hidden={section !== "Tracking"} className="space-y-3">
									<h3 className="text-sm font-semibold">{tr("UTM tracking")}</h3>
									<Field
										label={tr("Source")}
										value={form.source}
										onChange={(source) => {
											setForm((v) => ({ ...v, source }));
										}}
									/>
									<Field
										label={tr("Medium")}
										value={form.medium}
										onChange={(medium) => {
											setForm((v) => ({ ...v, medium }));
										}}
									/>
									<Field
										label={tr("Campaign")}
										value={form.trackingCampaign}
										onChange={(trackingCampaign) => {
											setForm((v) => ({ ...v, trackingCampaign }));
										}}
									/>
								</section>
							</div>
							{section === "Results" && (
								<div className="grid gap-3 sm:grid-cols-3">
									{Object.entries(selectedLink ? toLinkData(selectedLink) : {})
										.filter(([key, value]) => key.startsWith("total_") && typeof value === "number")
										.map(([key, value]) => (
											<div key={key} className="rounded border p-4">
												<p>{tr(key)}</p>
												<strong>{String(value)}</strong>
											</div>
										))}
								</div>
							)}
							<div className="flex justify-between gap-3">
								<Button variant="destructive" disabled={saving} onClick={() => void remove()}>
									{tr("Delete link")}
								</Button>
								<Button
									disabled={saving || !form.slug.trim() || !form.destination.trim()}
									onClick={() => void save()}
								>
									{tr(saving ? "Saving…" : "Save link")}
								</Button>
							</div>
						</>
					) : (
						<p role="status">{tr(loading ? "Loading item…" : "Item not found")}</p>
					)}
				</div>
			) : campaignId && !campaign ? null : (
				<div className="flex min-h-0 flex-col gap-4">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex min-w-[260px] flex-1 flex-wrap gap-2">
							<Input
								className="w-full min-w-[180px] max-w-[260px]"
								placeholder={tr("Search link")}
								value={searchTerm}
								onChange={(event) => {
									setSearchTerm(event.currentTarget.value);
								}}
							/>
							{!campaignId ? (
								<Select value={status} onValueChange={setStatus}>
									<SelectTrigger className="w-32">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={ACTIVE}>Active</SelectItem>
										<SelectItem value={ARCHIVED}>Archived</SelectItem>
									</SelectContent>
								</Select>
							) : null}
							<DateRangePicker date={dateRange} setDate={setDateRange} />
							<AdsPlatformSelect
								platformAdsOptions={adsFilterList}
								selectedAdsPlatform={linkType}
								setSelectedAdsPlatforms={setLinkType}
								title="Types"
								selectListTitle="Types"
							/>
							<AdsPlatformSelect
								platformAdsOptions={platformsFilterList}
								selectedAdsPlatform={platform}
								setSelectedAdsPlatforms={setPlatform}
								title="Platforms"
								selectListTitle="Platforms"
							/>
						</div>
						<div className="flex flex-wrap gap-2">
							<Button variant="outline" onClick={exportCsv}>
								<Download className="size-4" /> Export
							</Button>
							<CustomizeColumns
								columnOptions={columnOptions}
								selectedColumns={selectedColumns}
								setSelectedColumns={setSelectedColumns}
							/>
							<Button onClick={openCreate}>
								<Plus className="size-4" /> {tr("Create link")}
							</Button>
						</div>
					</div>
					<LinksTable
						selectedColumns={selectedColumns}
						data={visible}
						columns={columns}
						handleEditLink={openEdit}
						loading={loading}
						isCampaign={Boolean(campaignId)}
						isArchived={status === ARCHIVED}
						hasFilters={Boolean(searchTerm || linkType || platform)}
						onCreateLink={openCreate}
					/>
					{filtered.length ? (
						<PaginationFooter
							rowsPerPage={rowsPerPage}
							setRowsPerPage={setRowsPerPage}
							page={currentPage}
							setPage={setPage}
							totalRows={filtered.length}
							pageCount={pageCount}
						/>
					) : null}
				</div>
			)}

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{tr("Create link")}</DialogTitle>
						<DialogDescription>
							{tr("Add the link, then configure its destinations and tracking.")}
						</DialogDescription>
					</DialogHeader>
					<Field
						label={tr("Name")}
						value={form.name}
						onChange={(name) => {
							setForm((current) => ({ ...current, name }));
						}}
					/>
					<Field
						label={tr("Slug")}
						value={form.slug}
						onChange={(slug) => {
							setForm((current) => ({ ...current, slug }));
						}}
					/>
					<Field
						label={tr("Default destination")}
						type="url"
						value={form.destination}
						onChange={(destination) => {
							setForm((current) => ({ ...current, destination }));
						}}
					/>
					<DialogFooter>
						<Button
							disabled={saving || !form.slug.trim() || !form.destination.trim()}
							onClick={() => void save()}
						>
							{tr(saving ? "Saving…" : "Create link")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</ModulePage>
	);
}

function Field({
	label,
	value,
	onChange,
	type = "text",
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	type?: string;
}) {
	return (
		<label className="grid gap-2">
			<span>{label}</span>
			<Input
				type={type}
				value={value}
				onChange={(event) => {
					onChange(event.currentTarget.value);
				}}
			/>
		</label>
	);
}
