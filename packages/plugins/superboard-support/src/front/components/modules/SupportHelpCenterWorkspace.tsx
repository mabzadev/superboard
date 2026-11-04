import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { useEffect, useState } from "react";

import { supportPortals, type SupportPortal } from "../../api/support/helpCenterService.js";
import { getSupportAction } from "../../api/support/nativeClient.js";
import { useSupportI18n } from "../../i18n.js";
import { SupportEntityPage } from "../support/SupportEntityPage.js";
import { SupportDetail } from "../support/SupportModulePage.js";
import { SupportError, SupportMetric } from "../support/SupportUi.js";
import SupportHelpCenterPage, { type HelpCenterSection } from "./SupportHelpCenterPage.js";

const createPortal = (project: string, name: string) =>
	supportPortals.create(project, {
		name,
		slug: `${
			name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "") || "help"
		}-${crypto.randomUUID().slice(0, 8)}`,
		locale: "en",
		status: "draft",
		custom_domain: null,
		settings: {},
	});

export default function SupportHelpCenterWorkspace() {
	const { t } = useSupportI18n();
	return (
		<SupportEntityPage<SupportPortal>
			title={t("Help Center")}
			resource="help-center/portals"
			parameter="portal"
			path="/support/help-center"
			list={supportPortals.list}
			create={createPortal}
		>
			{(portal, project, update) => (
				<HelpCenterDetails key={portal.id} portal={portal} project={project} update={update} />
			)}
		</SupportEntityPage>
	);
}

const portalTabs = {
	articles: "Articles",
	structure: "Structure",
	translations: "Translations",
	settings: "Settings",
	reports: "Reports",
};
type PortalTab = keyof typeof portalTabs;
const isPortalTab = (value: string): value is PortalTab => Object.hasOwn(portalTabs, value);

function portalTab(search: string): PortalTab {
	const tab = new URLSearchParams(search).get("tab");
	if (tab === "content") return "articles";
	return tab && isPortalTab(tab) ? tab : "settings";
}

const contentSections: ReadonlyArray<HelpCenterSection> = ["articles", "structure", "translations"];

function HelpCenterDetails({
	portal,
	project,
	update,
}: {
	portal: SupportPortal;
	project: string;
	update: (portal: SupportPortal) => void;
}) {
	const { t } = useSupportI18n();
	const [tab, setTab] = useState(() => portalTab(window.location.search));
	return (
		<SupportDetail>
			<Tabs
				value={tab}
				onValueChange={(value) => {
					if (!isPortalTab(value)) return;
					setTab(value);
					const url = new URL(window.location.href);
					url.searchParams.set("tab", value);
					window.history.replaceState(null, "", url);
				}}
			>
				<TabsList aria-label={t("Help Center sections")} className="h-auto flex-wrap">
					{Object.entries(portalTabs).map(([value, label]) => (
						<TabsTrigger key={value} value={value}>
							{t(label)}
						</TabsTrigger>
					))}
				</TabsList>
				{contentSections.map((section) => (
					<TabsContent key={section} value={section}>
						<SupportHelpCenterPage portalId={portal.id} section={section} />
					</TabsContent>
				))}
				<TabsContent value="settings">
					<PortalSettings portal={portal} project={project} update={update} />
				</TabsContent>
				<TabsContent value="reports">
					<PortalReport portalId={portal.id} project={project} />
				</TabsContent>
			</Tabs>
		</SupportDetail>
	);
}

function PortalSettings({
	portal,
	project,
	update,
}: {
	portal: SupportPortal;
	project: string;
	update: (portal: SupportPortal) => void;
}) {
	const { t, locale } = useSupportI18n();
	const [draft, setDraft] = useState(portal);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const save = async () => {
		setSaving(true);
		try {
			const result = await supportPortals.update(project, portal.id, {
				name: draft.name,
				slug: draft.slug,
				locale: draft.locale,
				status: draft.status,
				custom_domain: draft.custom_domain || null,
			});
			update(result.data);
			setDraft(result.data);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};
	return (
		<form
			className="space-y-4 rounded-md border p-5"
			onSubmit={(event) => {
				event.preventDefault();
				void save().catch((cause: unknown) => {
					setError(moduleErrorMessage(cause, locale));
				});
			}}
		>
			<SupportError message={error} />
			{(
				[
					["name", "Name"],
					["slug", "Slug"],
					["locale", "Locale"],
					["custom_domain", "Custom domain"],
				] as const
			).map(([key, label]) => (
				<div className="space-y-2" key={key}>
					<Label htmlFor={`portal-${key}`}>{t(label)}</Label>
					<Input
						id={`portal-${key}`}
						value={draft[key] ?? ""}
						required={key !== "custom_domain"}
						onChange={(event) => {
							setDraft({ ...draft, [key]: event.target.value });
						}}
					/>
				</div>
			))}
			<Label htmlFor="portal-status">{t("Status")}</Label>
			<select
				id="portal-status"
				className="h-9 rounded-md border bg-background px-3"
				value={draft.status}
				onChange={(event) => {
					const value = event.target.value;
					if (value === "draft" || value === "published" || value === "disabled")
						setDraft({ ...draft, status: value });
				}}
			>
				<option value="draft">{t("Draft")}</option>
				<option value="published">{t("Published")}</option>
				<option value="disabled">{t("Disabled")}</option>
			</select>
			<div className="flex justify-end">
				<Button type="submit" disabled={saving}>
					{t("Save settings")}
				</Button>
			</div>
		</form>
	);
}

function PortalReport({ portalId, project }: { portalId: string; project: string }) {
	const { t, locale } = useSupportI18n();
	const [report, setReport] = useState<{
		articles: number;
		published: number;
		categories: number;
		views: number;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let active = true;
		void getSupportAction<{
			articles: number;
			published: number;
			categories: number;
			views: number;
		}>(project, "reports", { portal_id: portalId })
			.then((result) => {
				if (active) setReport(result.data);
			})
			.catch((cause: unknown) => {
				if (active) setError(moduleErrorMessage(cause, locale));
			});
		return () => {
			active = false;
		};
	}, [portalId, project, locale]);
	return (
		<>
			<SupportError message={error} />
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{(
					[
						["articles", "Articles"],
						["published", "Published"],
						["categories", "Categories"],
						["views", "Article views"],
					] as const
				).map(([key, label]) => (
					<SupportMetric key={key} label={t(label)} value={report ? report[key] : "—"} />
				))}
			</div>
		</>
	);
}
