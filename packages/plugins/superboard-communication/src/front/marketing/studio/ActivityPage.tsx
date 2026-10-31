import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { Button, Input } from "@superboard/front-ui/kumo";
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
import { useEffect, useState } from "react";

import { EmailAdministration } from "../../email/components/modules/EmailAdministration.js";
import { EmailMessages } from "../../email/EmailMessages.js";
import { MarketingOperations, MarketingStatistics } from "../components/modules/MarketingPages.js";
import { useStudioI18n } from "./i18n.js";
import { getStudioDeliveries, getStudioDelivery, type StudioDelivery } from "./service.js";
import { useWorkspaceTab } from "./workspace-navigation.js";

const tabs = { messages: "Message log", statistics: "Statistics", operations: "Operations" };

export function ActivityPage({ tab, fallback }: { tab: string; fallback: string }) {
	const { t } = useStudioI18n();
	const { selectedProject } = useProjectSelection();
	const { open } = useWorkspaceTab(fallback);
	const project = selectedProject?.id;
	return (
		<section className="ds-page space-y-5">
			<header className="ds-page-header">
				<div>
					<h1 className="ds-page-title">{t("Activity")}</h1>
					<p className="ds-page-description">
						{t("Every message sent, its results, and the deliveries that need attention.")}
					</p>
				</div>
			</header>
			<SectionNavigation />
			{project && (
				<Tabs
					value={tab}
					onValueChange={(value) => {
						open(String(value)).catch(() => undefined);
					}}
				>
					<TabsList aria-label={t("Activity sections")} className="h-auto flex-wrap">
						{Object.entries(tabs).map(([value, label]) => (
							<TabsTrigger key={value} value={value}>
								{t(label)}
							</TabsTrigger>
						))}
					</TabsList>
					<TabsContent value="messages">
						{tab === "messages" && <MessageLog key={project} project={project} />}
					</TabsContent>
					<TabsContent value="statistics">
						{tab === "statistics" && <MarketingStatistics key={project} />}
					</TabsContent>
					<TabsContent value="operations">
						{tab === "operations" && (
							<div className="space-y-8">
								<EmailAdministration key={`email:${project}`} section="operations" />
								<MarketingOperations key={`marketing:${project}`} />
							</div>
						)}
					</TabsContent>
				</Tabs>
			)}
		</section>
	);
}

/** Campaign and journey deliveries come from Marketing; system and transactional mail from the Email Worker. */
function MessageLog({ project }: { project: string }) {
	const { t } = useStudioI18n();
	const [source, setSource] = useState<"marketing" | "transactional">("marketing");
	return (
		<section className="space-y-4">
			<div className="flex gap-2" role="group" aria-label={t("Message source")}>
				<Button
					variant={source === "marketing" ? "secondary" : "ghost"}
					aria-pressed={source === "marketing"}
					onClick={() => {
						setSource("marketing");
					}}
				>
					{t("Campaigns and journeys")}
				</Button>
				<Button
					variant={source === "transactional" ? "secondary" : "ghost"}
					aria-pressed={source === "transactional"}
					onClick={() => {
						setSource("transactional");
					}}
				>
					{t("System and transactional emails")}
				</Button>
			</div>
			{source === "transactional" ? (
				<EmailMessages project={project} />
			) : (
				<MarketingDeliveries project={project} />
			)}
		</section>
	);
}

function MarketingDeliveries({ project }: { project: string }) {
	const { t } = useStudioI18n();
	const [values, setValues] = useState<StudioDelivery[]>([]);
	const [query, setQuery] = useState("");
	const [cursor, setCursor] = useState<string>();
	const [selected, setSelected] = useState<StudioDelivery>();
	const [error, setError] = useState("");
	useEffect(() => {
		let active = true;
		const timer = setTimeout(() => {
			void getStudioDeliveries(project, query ? { q: query } : {}).then(
				(result) => {
					if (active) {
						setValues(result.items);
						setCursor(result.nextCursor);
					}
				},
				() => {
					if (active) setError(t("Loading failed"));
				},
			);
		}, 250);
		return () => {
			active = false;
			clearTimeout(timer);
		};
	}, [project, query, t]);
	return (
		<section className="space-y-4">
			<Input
				aria-label={t("Recipient")}
				placeholder={t("Search by recipient")}
				value={query}
				onChange={(event) => {
					setQuery(event.target.value);
				}}
			/>
			{error && <p role="alert">{error}</p>}
			<div className="overflow-auto rounded-lg border border-kumo-line">
				<FrontTable className="w-full text-start text-sm">
					<FrontTableHeader className="bg-kumo-tint">
						<FrontTableRow>
							{["Recipient", "Subject", "Language", "Status"].map((key) => (
								<FrontTableHead key={key} className="p-4 text-start font-medium">
									{t(key)}
								</FrontTableHead>
							))}
						</FrontTableRow>
					</FrontTableHeader>
					<FrontTableBody>
						{values.map((value) => (
							<FrontTableRow key={value.delivery_id} className="border-t border-kumo-line">
								<FrontTableCell className="p-4">{value.recipient_email}</FrontTableCell>
								<FrontTableCell>
									<Button
										variant="ghost"
										onClick={() => {
											getStudioDelivery(project, value.delivery_id).then(setSelected, () => {
												setError(t("Loading failed"));
											});
										}}
									>
										{value.subject ?? t(value.reason)}
									</Button>
								</FrontTableCell>
								<FrontTableCell>{value.locale ?? "—"}</FrontTableCell>
								<FrontTableCell>{value.status ? t(value.status) : t(value.reason)}</FrontTableCell>
							</FrontTableRow>
						))}
					</FrontTableBody>
				</FrontTable>
				{!values.length && !error && (
					<p className="p-5 text-kumo-subtle">
						{t(
							query
								? "No deliveries match this recipient."
								: "No deliveries yet. Campaign and journey emails appear here once they are sent.",
						)}
					</p>
				)}
			</div>
			{cursor && (
				<Button
					onClick={() => {
						getStudioDeliveries(project, { cursor, ...(query ? { q: query } : {}) }).then(
							(result) => {
								setValues((items) => [...items, ...result.items]);
								setCursor(result.nextCursor);
							},
							() => {
								setError(t("Loading failed"));
							},
						);
					}}
				>
					{t("Load more")}
				</Button>
			)}
			{selected && (
				<div className="space-y-3 rounded-lg border border-kumo-line p-5">
					<div className="flex justify-between gap-3">
						<p>
							{selected.subject} · {selected.locale} · {t(selected.reason)}
						</p>
						<Button
							variant="ghost"
							onClick={() => {
								setSelected(undefined);
							}}
						>
							{t("Close")}
						</Button>
					</div>
					{selected.last_error && <p role="alert">{selected.last_error}</p>}
					{selected.content_html ? (
						<iframe
							title={t("View message")}
							sandbox=""
							srcDoc={selected.content_html}
							className="h-[600px] w-full border-0"
						/>
					) : (
						<p className="p-6 text-sm text-kumo-subtle">{t("Message body unavailable")}</p>
					)}
				</div>
			)}
		</section>
	);
}
