"use client";
import { createStudioDocument, useExperienceI18n } from "@superboard/front-ui/experience-studio";
import { Button } from "@superboard/front-ui/kumo";
import { useDraftAutosave } from "@superboard/front-ui/use-draft-autosave";
import { FlaskConical, MapPin, Pencil, Plus, Rocket, Target, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	EmptyProject,
	ModulePage,
	moduleErrorMessage,
} from "../../../../../../../../../supbrd-front-ui/src/shared/components/modules/ModulePage.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../../../../../../../supbrd-front-ui/src/shared/components/ui/card.js";
import { Input } from "../../../../../../../../../supbrd-front-ui/src/shared/components/ui/input.js";
import { Switch } from "../../../../../../../../../supbrd-front-ui/src/shared/components/ui/switch.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../../../../../../../../supbrd-front-ui/src/shared/components/ui/table.js";
import { useProjectSelection } from "../../../../../../../../../supbrd-front-ui/src/shared/context/useProjectSelection.js";
import { ApiError } from "../../../../../../../../../supbrd-front-ui/src/shared/lib/ApiError.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "../../../../../../../../../supbrd-front-ui/src/shared/lib/Notifications.js";
import {
	createOnboarding,
	createOnboardingExperience,
	createOnboardingTargetingRule,
	createOnboardingVersion,
	deleteOnboarding,
	deleteOnboardingPlacement,
	deleteOnboardingTargetingRule,
	getOnboardingExperiences,
	getOnboardingPlacements,
	getOnboardings,
	getOnboardingStatistics,
	getOnboardingTargetingRules,
	getOnboardingVersions,
	publishOnboarding,
	saveOnboardingPlacement,
	setOnboardingExperienceStatus,
	updateOnboarding,
	type Onboarding,
	type OnboardingExperience,
	type OnboardingPlacement,
	type OnboardingStatistics,
	type OnboardingTargetingRule,
	type OnboardingVersion,
} from "../../api/onboardings/onboardingsService.js";
import {
	ExperienceEditor,
	ExperienceStatisticsFilters,
	fromOnboardingDefinition,
	toOnboardingDefinition,
	type ExperienceDocument,
} from "../experience-editor/index.js";

const errorMessage = (error: unknown) =>
	error instanceof ApiError ? error.message : moduleErrorMessage(error);

export function OnboardingsPage() {
	const { t, locale } = useExperienceI18n();
	const [studioTab, setStudioTab] = useState("Design");
	const [compared, setCompared] = useState<string[]>([]);
	const { selectedProject } = useProjectSelection();
	const [items, setItems] = useState<Onboarding[]>([]);
	const [selected, setSelected] = useState<Onboarding>();
	const [versions, setVersions] = useState<OnboardingVersion[]>([]);
	const [placements, setPlacements] = useState<OnboardingPlacement[]>([]);
	const [targetingRules, setTargetingRules] = useState<OnboardingTargetingRule[]>([]);
	const [experiences, setExperiences] = useState<OnboardingExperience[]>([]);
	const [identifier, setIdentifier] = useState("");
	const [name, setName] = useState("");
	const [metadata, setMetadata] = useState({
		display_name: "",
		description: "",
	});
	const [document, setDocument] = useState<ExperienceDocument>(() =>
		createStudioDocument("onboarding", locale),
	);
	const [documentValid, setDocumentValid] = useState(true);
	const [editorKey, setEditorKey] = useState("new");
	const [editorLoading, setEditorLoading] = useState(false);
	const editorRequest = useRef(0);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const draftStatus = useDraftAutosave({
		resourceKey: (selectedProject?.id ?? "") + ":" + (selected?.id ?? "") + ":" + editorKey,
		value: toOnboardingDefinition(document),
		enabled: Boolean(selectedProject && selected && documentValid && !busy && !editorLoading),
		save: async (value) =>
			createOnboardingVersion(selectedProject!.id, selected!.id, { configuration: value }),
		onSaved: (version) => setVersions((values) => [version, ...values]),
	});

	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const [onboardings, projectPlacements, rules, projectExperiences] = await Promise.all([
				getOnboardings(selectedProject.id),
				getOnboardingPlacements(selectedProject.id),
				getOnboardingTargetingRules(selectedProject.id),
				getOnboardingExperiences(selectedProject.id),
			]);
			setItems(onboardings);
			setPlacements(projectPlacements);
			setTargetingRules(rules);
			setExperiences(projectExperiences);
			setError(null);
		} catch (cause) {
			setError(errorMessage(cause));
		}
	}, [selectedProject]);

	useEffect(() => {
		void load();
	}, [load]);

	const open = async (item: Onboarding) => {
		if (!selectedProject) return;
		const request = ++editorRequest.current;
		setEditorLoading(true);
		try {
			const result = await getOnboardingVersions(selectedProject.id, item.id);
			if (request !== editorRequest.current) return;
			setSelected(item);
			setMetadata({ display_name: item.display_name, description: item.description ?? "" });
			setVersions(result);
			const latest = result[0];
			setDocument(fromOnboardingDefinition(latest?.configuration));
			setEditorKey(`${item.id}:${latest?.id ?? "new"}`);
		} catch (cause) {
			if (request === editorRequest.current) showErrorNotification(errorMessage(cause));
		} finally {
			if (request === editorRequest.current) setEditorLoading(false);
		}
	};

	const saveMetadata = async () => {
		if (!selectedProject || !selected || !metadata.display_name || busy) return;
		setBusy(true);
		try {
			await updateOnboarding(selectedProject.id, selected.id, {
				display_name: metadata.display_name,
				description: metadata.description || null,
			});
			setSelected((current) => (current ? { ...current, ...metadata } : current));
			showSuccessNotification(t("Onboarding details updated"));
			await load();
		} catch (cause) {
			showErrorNotification(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	};

	const removeOnboarding = async () => {
		if (!selectedProject || !selected || busy) return;
		setBusy(true);
		try {
			await deleteOnboarding(selectedProject.id, selected.id);
			setSelected(undefined);
			setVersions([]);
			setDocument(createStudioDocument("onboarding", locale));
			setEditorKey("new");
			showSuccessNotification(t("Onboarding deleted"));
			await load();
		} catch (cause) {
			showErrorNotification(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	};

	const create = async () => {
		if (!selectedProject || !identifier || !name || busy) return;
		setBusy(true);
		try {
			const result = await createOnboarding(selectedProject.id, {
				identifier,
				display_name: name,
				configuration: toOnboardingDefinition(document),
			});
			setIdentifier("");
			setName("");
			showSuccessNotification(t("Onboarding and first draft created"));
			await load();
			await open(result);
		} catch (cause) {
			showErrorNotification(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	};

	const save = async () => {
		if (!selectedProject || !selected || !documentValid || busy) return;
		setBusy(true);
		try {
			const version = await createOnboardingVersion(selectedProject.id, selected.id, {
				configuration: toOnboardingDefinition(document),
			});
			showSuccessNotification(`Draft v${version.version} saved`);
			await open(selected);
		} catch (cause) {
			showErrorNotification(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	};

	const publish = async (id: string) => {
		if (!selectedProject || !selected || busy) return;
		setBusy(true);
		try {
			await publishOnboarding(selectedProject.id, selected.id, id);
			showSuccessNotification(t("Onboarding version published"));
			await Promise.all([load(), open(selected)]);
		} catch (cause) {
			showErrorNotification(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	};

	return (
		<ModulePage
			title={t("Onboardings")}
			description={t("Design multi-screen flows, target audiences and publish experiments.")}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="grid gap-6">
					<details open={!selected}>
						<summary className="cursor-pointer rounded-lg border border-kumo-line bg-kumo-base p-3 font-medium">
							{t("Library")}
						</summary>
						<Card className="border-kumo-line bg-kumo-base">
							<CardContent className="space-y-3">
								<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
									<Input
										placeholder={t("Identifier")}
										value={identifier}
										onChange={(event) =>
											setIdentifier(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_"))
										}
									/>
									<Input
										placeholder={t("Display name")}
										value={name}
										onChange={(event) => {
											const next = event.target.value;
											const slug = (text: string) =>
												text
													.normalize("NFKD")
													.replace(/[\u0300-\u036f]/g, "")
													.toLowerCase()
													.replace(/[^a-z0-9]+/g, "_")
													.replace(/^_+|_+$/g, "");
											if (!identifier || identifier === slug(name)) setIdentifier(slug(next));
											setName(next);
										}}
									/>
									<Button
										className="w-full"
										disabled={busy || !identifier || !name || !documentValid}
										onClick={() => void create()}
									>
										<Plus />
										{t("Create onboarding")}
									</Button>
								</div>
								<div className="space-y-2 border-t pt-4">
									{items.map((item) => (
										<button
											key={item.id}
											className={`w-full rounded-lg border p-3 text-start ${selected?.id === item.id ? "border-primary bg-primary/5" : ""}`}
											onClick={() => void open(item)}
										>
											<b>{item.display_name}</b>
											<p className="text-xs text-muted-foreground">
												{item.identifier} {t("·")}{" "}
												{item.active_version
													? `v${item.active_version} published`
													: "not published"}
											</p>
										</button>
									))}
									{!items.length && (
										<p className="text-sm text-muted-foreground">{t("No onboardings yet.")}</p>
									)}
								</div>
							</CardContent>
						</Card>
					</details>
					<div className="space-y-6">
						<nav className="flex gap-2">
							{["Design", "Delivery", "Versions", "Results"].map((tab) => (
								<Button
									key={tab}
									variant={studioTab === tab ? "secondary" : "ghost"}
									onClick={() => setStudioTab(tab)}
								>
									{t(tab)}
								</Button>
							))}
						</nav>
						<Card
							className="border-kumo-line bg-kumo-base"
							hidden={!["Design", "Versions"].includes(studioTab)}
						>
							<CardHeader>
								<CardTitle>
									{selected
										? `${t("Edit")} ${selected.display_name}`
										: t("Visual onboarding editor")}
								</CardTitle>
								<CardDescription>
									{t(
										"Reorder screens and blocks, configure transitions, theme and mobile preview.",
									)}
								</CardDescription>
							</CardHeader>
							<CardContent
								className="space-y-4"
								inert={busy || editorLoading}
								aria-busy={busy || editorLoading}
							>
								{selected && (
									<details>
										<summary className="cursor-pointer py-2 text-sm text-kumo-subtle">
											{t("Details")}
										</summary>
										<div className="grid gap-3 rounded-lg border border-kumo-line p-4 md:grid-cols-[1fr_2fr_auto_auto]">
											<label className="space-y-1 text-xs">
												{t("Display name")}
												<Input
													value={metadata.display_name}
													onChange={(event) =>
														setMetadata((value) => ({
															...value,
															display_name: event.target.value,
														}))
													}
												/>
											</label>
											<label className="space-y-1 text-xs">
												{t("Description")}
												<Input
													value={metadata.description}
													onChange={(event) =>
														setMetadata((value) => ({
															...value,
															description: event.target.value,
														}))
													}
												/>
											</label>
											<Button
												className="self-end"
												disabled={busy || !metadata.display_name}
												onClick={() => void saveMetadata()}
											>
												{t("Save details")}
											</Button>
											<Button
												className="self-end"
												variant="outline"
												disabled={busy}
												onClick={() => void removeOnboarding()}
											>
												<Trash2 />
												{t("Delete")}
											</Button>
										</div>
									</details>
								)}
								<p role="status" className="text-xs text-kumo-subtle">
									{t(selected ? draftStatus : "Create to save")}
								</p>
								<div hidden={studioTab !== "Design"}>
									<ExperienceEditor
										key={editorKey}
										kind="onboarding"
										initialDocument={document}
										onChange={(value, valid) => {
											setDocument(value);
											setDocumentValid(valid);
										}}
									/>
								</div>
								<Button
									disabled={!selected || busy || editorLoading || !documentValid}
									onClick={() => void save()}
								>
									<Plus />
									{t("Save immutable draft")}
								</Button>
								<div hidden={studioTab !== "Versions"} className="space-y-2 border-t pt-4">
									<p className="text-sm font-medium">{t("Version history")}</p>
									{versions.map((version) => (
										<div
											key={version.id}
											className="flex items-center justify-between rounded-lg border p-3"
										>
											<button
												className="text-start"
												onClick={() => {
													setDocument(fromOnboardingDefinition(version.configuration));
													setEditorKey(`${selected?.id}:${version.id}:load`);
												}}
											>
												<b>
													{t("Version")} {version.version}
												</b>
												<p className="text-xs capitalize text-muted-foreground">
													{t(version.state)}
												</p>
											</button>
											<Button
												size="sm"
												variant={compared.includes(version.id) ? "secondary" : "ghost"}
												onClick={() =>
													setCompared((value) =>
														value.includes(version.id)
															? value.filter((id) => id !== version.id)
															: [...value.slice(-1), version.id],
													)
												}
											>
												{t("Compare")}
											</Button>
											<Button
												variant="outline"
												disabled={busy || version.state === "published"}
												onClick={() => void publish(version.id)}
											>
												<Rocket />
												{t("Publish")}
											</Button>
										</div>
									))}
								</div>
								{studioTab === "Versions" && compared.length === 2 && (
									<section>
										<h3 className="mb-4 font-semibold">{t("Compare versions")}</h3>
										<div className="grid gap-4 xl:grid-cols-2">
											{versions
												.filter((version) => compared.includes(version.id))
												.map((version) => (
													<div key={version.id}>
														<p className="mb-2">v{version.version}</p>
														<ExperienceEditor
															previewOnly
															kind="onboarding"
															initialDocument={fromOnboardingDefinition(version.configuration)}
														/>
													</div>
												))}
										</div>
									</section>
								)}
							</CardContent>
						</Card>
						{studioTab === "Results" && <OnboardingStatisticsPage />}
						{selected && studioTab === "Delivery" && (
							<OnboardingDeliveryControls
								projectRef={selectedProject.id}
								onboarding={selected}
								versions={versions}
								placements={placements.filter((item) => item.onboarding_id === selected.id)}
								rules={targetingRules}
								experiences={experiences}
								onChanged={load}
							/>
						)}
					</div>
				</div>
			)}
		</ModulePage>
	);
}

function OnboardingDeliveryControls({
	projectRef,
	onboarding,
	versions,
	placements,
	rules,
	experiences,
	onChanged,
}: {
	projectRef: string;
	onboarding: Onboarding;
	versions: OnboardingVersion[];
	placements: OnboardingPlacement[];
	rules: OnboardingTargetingRule[];
	experiences: OnboardingExperience[];
	onChanged: () => Promise<void>;
}) {
	const { t } = useExperienceI18n();
	const published = versions.filter(({ state }) => state === "published");
	const [placementKey, setPlacementKey] = useState("app_launch");
	const [placementName, setPlacementName] = useState("App launch");
	const [versionId, setVersionId] = useState("");
	const [priority, setPriority] = useState(100);
	const [active, setActive] = useState(true);
	const [rulePlatform, setRulePlatform] = useState("ios");
	const [ruleLocale, setRuleLocale] = useState("");
	const [experimentName, setExperimentName] = useState("First-run completion test");
	const [editingPlacementId, setEditingPlacementId] = useState<string>();
	const [rulePlacementId, setRulePlacementId] = useState("");
	const [experimentPlacementId, setExperimentPlacementId] = useState("");
	const [busy, setBusy] = useState(false);
	const savePlacement = async () => {
		setBusy(true);
		try {
			await saveOnboardingPlacement(
				projectRef,
				{
					key: placementKey,
					name: placementName,
					onboarding_id: onboarding.id,
					active_version_id: versionId || null,
					priority,
					active,
				},
				editingPlacementId,
			);
			setEditingPlacementId(undefined);
			showSuccessNotification(editingPlacementId ? "Placement updated" : "Placement saved");
			await onChanged();
		} catch (cause) {
			showErrorNotification(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	};
	const editPlacement = (placement: OnboardingPlacement) => {
		setEditingPlacementId(placement.id);
		setPlacementKey(placement.key);
		setPlacementName(placement.name);
		setVersionId(placement.active_version_id ?? "");
		setPriority(placement.priority);
		setActive(Boolean(placement.active));
	};
	const removePlacement = async (id: string) => {
		setBusy(true);
		try {
			await deleteOnboardingPlacement(projectRef, id);
			if (editingPlacementId === id) setEditingPlacementId(undefined);
			showSuccessNotification(t("Placement deleted"));
			await onChanged();
		} catch (cause) {
			showErrorNotification(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	};
	const createRule = async () => {
		const placement = placements.find(({ id }) => id === rulePlacementId);
		if (!placement) return;
		setBusy(true);
		try {
			await createOnboardingTargetingRule(projectRef, {
				placement_id: placement.id,
				name: `${rulePlatform}${ruleLocale ? ` ${ruleLocale}` : ""} audience`,
				priority: 100,
				conditions: {
					platform: rulePlatform,
					...(ruleLocale ? { locale: ruleLocale } : {}),
				},
				active: true,
			});
			showSuccessNotification(t("Targeting rule created"));
			await onChanged();
		} catch (cause) {
			showErrorNotification(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	};
	const removeRule = async (id: string) => {
		setBusy(true);
		try {
			await deleteOnboardingTargetingRule(projectRef, id);
			showSuccessNotification(t("Targeting rule deleted"));
			await onChanged();
		} catch (cause) {
			showErrorNotification(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	};
	const createExperiment = async () => {
		const placement = placements.find(({ id }) => id === experimentPlacementId);
		if (!placement || published.length < 2) return;
		setBusy(true);
		try {
			await createOnboardingExperience(projectRef, {
				placement_id: placement.id,
				name: experimentName,
				status: "draft",
				traffic_percentage: 10000,
				variants: published.slice(0, 2).map((version, index) => ({
					id: crypto.randomUUID(),
					name: index ? "Variant B" : "Control",
					weight: 5000,
					version_id: version.id,
				})),
			});
			showSuccessNotification(t("A/B experience created as draft"));
			await onChanged();
		} catch (cause) {
			showErrorNotification(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	};
	const setExperimentStatus = async (
		experience: OnboardingExperience,
		status: OnboardingExperience["status"],
	) => {
		setBusy(true);
		try {
			await setOnboardingExperienceStatus(projectRef, experience.id, status);
			showSuccessNotification(`Experiment ${status}`);
			await onChanged();
		} catch (cause) {
			showErrorNotification(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	};
	const onboardingPlacementIds = new Set(placements.map(({ id }) => id));
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<MapPin />
					{t("Delivery, targeting and A/B")}
				</CardTitle>
				<CardDescription>
					{t(
						"Resolve one published flow using placement priority, audience rules and stable variants.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-5">
				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
					<label className="space-y-1 text-xs">
						{t("Placement key")}
						<Input
							value={placementKey}
							onChange={(event) =>
								setPlacementKey(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_"))
							}
						/>
					</label>
					<label className="space-y-1 text-xs">
						{t("Name")}
						<Input
							value={placementName}
							onChange={(event) => setPlacementName(event.target.value)}
						/>
					</label>
					<label className="space-y-1 text-xs">
						{t("Published version")}
						<select
							className="block h-9 w-full rounded-md border bg-background px-3 text-sm"
							value={versionId}
							onChange={(event) => setVersionId(event.target.value)}
						>
							<option value="">{t("Use onboarding active version")}</option>
							{published.map((version) => (
								<option key={version.id} value={version.id}>
									{t("Version")}
									{version.version}
								</option>
							))}
						</select>
					</label>
					<label className="space-y-1 text-xs">
						{t("Priority")}
						<Input
							type="number"
							value={priority}
							onChange={(event) => setPriority(Number(event.target.value))}
						/>
					</label>
				</div>
				<div className="flex items-center justify-between">
					<label className="flex items-center gap-2 text-sm">
						<Switch checked={active} onCheckedChange={setActive} />
						{t("Active")}
					</label>
					<Button
						disabled={busy || !placementKey || !placementName}
						onClick={() => void savePlacement()}
					>
						{t("Save placement")}
					</Button>
				</div>
				{placements.map((placement) => (
					<div
						key={placement.id}
						className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"
					>
						<span>
							<b>{placement.name}</b>
							<span className="ml-2 text-muted-foreground">
								{placement.key} {t("· priority")} {placement.priority} {t("·")}{" "}
								{placement.active ? "active" : "inactive"}
							</span>
						</span>
						<span className="flex gap-1">
							<Button
								shape="square"
								variant="ghost"
								aria-label={`Edit placement ${placement.name}`}
								onClick={() => editPlacement(placement)}
							>
								<Pencil />
							</Button>
							<Button
								shape="square"
								variant="ghost"
								aria-label={`Delete placement ${placement.name}`}
								disabled={busy}
								onClick={() => void removePlacement(placement.id)}
							>
								<Trash2 />
							</Button>
						</span>
					</div>
				))}
				<div className="grid gap-3 border-t pt-4 md:grid-cols-4">
					<label className="space-y-1 text-xs">
						{t("Placement")}
						<select
							className="block h-9 w-full rounded-md border bg-background px-3 text-sm"
							value={rulePlacementId}
							onChange={(event) => setRulePlacementId(event.target.value)}
						>
							<option value="">{t("Select…")}</option>
							{placements.map((placement) => (
								<option key={placement.id} value={placement.id}>
									{placement.name}
								</option>
							))}
						</select>
					</label>
					<label className="space-y-1 text-xs">
						{t("Platform")}
						<select
							className="block h-9 w-full rounded-md border bg-background px-3 text-sm"
							value={rulePlatform}
							onChange={(event) => setRulePlatform(event.target.value)}
						>
							<option value="ios">{t("iOS")}</option>
							<option value="android">{t("Android")}</option>
							<option value="web">{t("Web")}</option>
						</select>
					</label>
					<label className="space-y-1 text-xs">
						{t("Locale (optional)")}
						<Input
							value={ruleLocale}
							onChange={(event) => setRuleLocale(event.target.value)}
							placeholder={t("fr-FR")}
						/>
					</label>
					<Button
						className="self-end"
						variant="outline"
						disabled={busy || !rulePlacementId}
						onClick={() => void createRule()}
					>
						<Target />
						{t("Add audience rule")}
					</Button>
				</div>
				{rules
					.filter((rule) => onboardingPlacementIds.has(rule.placement_id))
					.map((rule) => (
						<div
							key={rule.id}
							className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"
						>
							<span>
								<b>{rule.name}</b>
								<span className="ml-2 text-muted-foreground">
									{t("priority")} {rule.priority}
								</span>
							</span>
							<Button
								shape="square"
								variant="ghost"
								aria-label={`Delete rule ${rule.name}`}
								disabled={busy}
								onClick={() => void removeRule(rule.id)}
							>
								<Trash2 />
							</Button>
						</div>
					))}
				<div className="grid gap-3 border-t pt-4 md:grid-cols-[1fr_1fr_auto]">
					<label className="space-y-1 text-xs">
						{t("Experiment name")}
						<Input
							value={experimentName}
							onChange={(event) => setExperimentName(event.target.value)}
						/>
					</label>
					<label className="space-y-1 text-xs">
						{t("Placement")}
						<select
							className="block h-9 w-full rounded-md border bg-background px-3 text-sm"
							value={experimentPlacementId}
							onChange={(event) => setExperimentPlacementId(event.target.value)}
						>
							<option value="">{t("Select…")}</option>
							{placements.map((placement) => (
								<option key={placement.id} value={placement.id}>
									{placement.name}
								</option>
							))}
						</select>
					</label>
					<Button
						className="self-end"
						variant="outline"
						disabled={busy || !experimentPlacementId || published.length < 2}
						onClick={() => void createExperiment()}
					>
						<FlaskConical />
						{t("Create 50/50 test")}
					</Button>
				</div>
				{published.length < 2 && (
					<p className="text-xs text-muted-foreground">
						{t("Publish two versions to create an A/B experiment.")}
					</p>
				)}
				{experiences
					.filter((experience) => onboardingPlacementIds.has(experience.placement_id))
					.map((experience) => (
						<div
							key={experience.id}
							className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"
						>
							<span>
								<b>{experience.name}</b>
								<span className="ml-2 capitalize text-muted-foreground">
									{experience.status} {t("·")} {experience.variants.length} {t("variants")}
								</span>
							</span>
							<span className="flex gap-1">
								<Button
									size="sm"
									variant="outline"
									disabled={busy || experience.status === "completed"}
									onClick={() =>
										void setExperimentStatus(
											experience,
											experience.status === "running" ? "paused" : "running",
										)
									}
								>
									{experience.status === "running" ? "Pause" : "Start"}
								</Button>
								<Button
									size="sm"
									variant="ghost"
									disabled={busy || experience.status === "completed"}
									onClick={() => void setExperimentStatus(experience, "completed")}
								>
									{t("Complete")}
								</Button>
							</span>
						</div>
					))}
			</CardContent>
		</Card>
	);
}

export function OnboardingStatisticsPage() {
	const { t } = useExperienceI18n();
	const { selectedProject } = useProjectSelection();
	const [data, setData] = useState<OnboardingStatistics>();
	const [error, setError] = useState<string | null>(null);
	const defaultFilters = useMemo(
		() => ({
			from: new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10),
			to: new Date().toISOString().slice(0, 10),
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			interval: "day",
			platform: "",
			placement_id: "",
			version_id: "",
			experience_id: "",
			variant_id: "",
		}),
		[],
	);
	const [filters, setFilters] = useState(defaultFilters);
	useEffect(() => {
		if (selectedProject) {
			setError(null);
			getOnboardingStatistics(selectedProject.id, filters)
				.then(setData)
				.catch((cause) => setError(errorMessage(cause)));
		}
	}, [selectedProject, filters]);
	return (
		<ModulePage
			title={t("Onboarding statistics")}
			description={t("Completion and drop-off across published onboarding flows.")}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<>
					<ExperienceStatisticsFilters value={filters} onChange={setFilters} />
					<div className="grid gap-4 md:grid-cols-3">
						{Object.entries(data?.totals ?? {}).map(([key, value]) => (
							<Card key={key}>
								<CardHeader>
									<CardDescription>{key.replaceAll("_", " ")}</CardDescription>
									<CardTitle className="text-3xl">{value.toLocaleString()}</CardTitle>
								</CardHeader>
							</Card>
						))}
						<Card>
							<CardHeader>
								<CardDescription>{t("completion rate")}</CardDescription>
								<CardTitle className="text-3xl">
									{((data?.completion_rate ?? 0) * 100).toFixed(1)}
									{t("%")}
								</CardTitle>
							</CardHeader>
						</Card>
						<Card>
							<CardHeader>
								<CardDescription>{t("drop-off rate")}</CardDescription>
								<CardTitle className="text-3xl">
									{((data?.drop_off_rate ?? 0) * 100).toFixed(1)}
									{t("%")}
								</CardTitle>
							</CardHeader>
						</Card>
					</div>
					<Card>
						<CardHeader>
							<CardTitle>{t("Step funnel")}</CardTitle>
						</CardHeader>
						<CardContent>
							{data?.funnel.map((row) => (
								<div key={row.step} className="flex justify-between border-b py-3">
									<span>{row.step}</span>
									<b>{row.count.toLocaleString()}</b>
								</div>
							))}
							{!data?.funnel.length && (
								<p className="text-sm text-muted-foreground">
									{t("No step events match this period.")}
								</p>
							)}
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>{t("Event timeline")}</CardTitle>
							<CardDescription>
								{t("Detailed events for the active statistical dimensions.")}
							</CardDescription>
						</CardHeader>
						<CardContent className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t("Date")}</TableHead>
										<TableHead>{t("Event")}</TableHead>
										<TableHead>{t("Step")}</TableHead>
										<TableHead>{t("Platform")}</TableHead>
										<TableHead>{t("Placement")}</TableHead>
										<TableHead>{t("Count")}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{(data?.series ?? []).map((row, index) => (
										<TableRow key={`${row.date}:${row.event_type}:${row.step_id ?? ""}:${index}`}>
											<TableCell>{row.date}</TableCell>
											<TableCell className="capitalize">
												{row.event_type.replaceAll("_", " ")}
											</TableCell>
											<TableCell>{row.step_id || "—"}</TableCell>
											<TableCell>{row.platform || "—"}</TableCell>
											<TableCell>{row.placement || "—"}</TableCell>
											<TableCell>{Number(row.count).toLocaleString()}</TableCell>
										</TableRow>
									))}
									{!data?.series.length && (
										<TableRow>
											<TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
												{t("No events match this period.")}
											</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				</>
			)}
		</ModulePage>
	);
}
