import { EMAIL_PURPOSES } from "@superboard/contracts/email-studio";
import { Input, Loader, Select } from "@superboard/front-ui/kumo";
import {
	Table as FrontTable,
	TableHeader as FrontTableHeader,
	TableBody as FrontTableBody,
	TableRow as FrontTableRow,
	TableHead as FrontTableHead,
	TableCell as FrontTableCell,
} from "@superboard/front-ui/ui/table.js";
import { useEffect, useState } from "react";

import { useStudioI18n } from "./i18n.js";
import { getStudioStatistics, type StudioStatistics } from "./service.js";

const localDay = (date: Date) =>
	[
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, "0"),
		String(date.getDate()).padStart(2, "0"),
	].join("-");
export function EmailAnalytics({
	project,
	locales,
	templateId,
}: {
	project: string;
	locales: string[];
	templateId?: string;
}) {
	const { t } = useStudioI18n();
	const [filters, setFilters] = useState({
		from: localDay(new Date(Date.now() - 29 * 86400000)),
		to: localDay(new Date()),
		locale: "",
		purpose: "",
	});
	const [data, setData] = useState<StudioStatistics>();
	const [error, setError] = useState("");
	useEffect(() => {
		let active = true;
		setData(undefined);
		setError("");
		const query = {
			...filters,
			...(templateId ? { template_id: templateId } : {}),
			from: new Date(filters.from + "T00:00:00").toISOString(),
			to: new Date(filters.to + "T23:59:59").toISOString(),
		};
		void getStudioStatistics(project, query).then(
			(value) => {
				if (active) setData(value);
			},
			() => {
				if (active) setError(t("Loading failed"));
			},
		);
		return () => {
			active = false;
		};
	}, [project, filters, t, templateId]);
	return (
		<section className="space-y-4">
			<div className="grid gap-3 md:grid-cols-4">
				<Input
					label={t("From date") + " · " + Intl.DateTimeFormat().resolvedOptions().timeZone}
					type="date"
					value={filters.from}
					onChange={(event) => {
						if (event.target.value) setFilters({ ...filters, from: event.target.value });
					}}
				/>
				<Input
					label={t("To date")}
					type="date"
					value={filters.to}
					onChange={(event) => {
						if (event.target.value) setFilters({ ...filters, to: event.target.value });
					}}
				/>
				<Select
					label={t("Language")}
					value={filters.locale}
					onValueChange={(value) => setFilters({ ...filters, locale: value ?? "" })}
					items={{
						"": t("All"),
						...Object.fromEntries(locales.map((locale) => [locale, locale.toUpperCase()])),
					}}
				/>
				<Select
					label={t("Purpose")}
					value={filters.purpose}
					onValueChange={(value) => setFilters({ ...filters, purpose: value ?? "" })}
					items={{
						"": t("All"),
						...Object.fromEntries(EMAIL_PURPOSES.map((purpose) => [purpose, t(purpose)])),
					}}
				/>
			</div>
			{error ? (
				<p role="alert">{error}</p>
			) : !data ? (
				<Loader />
			) : (
				<>
					<div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
						{["messages", "sent", "delivered", "opens", "clicks", "failed"].map((key) => (
							<div key={key} className="rounded-lg border border-kumo-line bg-kumo-base p-5">
								<p className="text-xs text-kumo-subtle">{t(key)}</p>
								<p className="mt-3 text-2xl font-semibold tabular-nums">{data.totals[key] ?? 0}</p>
							</div>
						))}
					</div>
					<div className="overflow-auto rounded-lg border border-kumo-line">
						<FrontTable className="w-full text-start text-sm">
							<FrontTableHeader className="bg-kumo-tint">
								<FrontTableRow>
									{[
										"Language",
										"Purpose",
										"messages",
										"sent",
										"delivered",
										"opens",
										"clicks",
										"failed",
									].map((key) => (
										<FrontTableHead key={key} className="p-3 text-start font-medium">
											{t(key)}
										</FrontTableHead>
									))}
								</FrontTableRow>
							</FrontTableHeader>
							<FrontTableBody>
								{data.groups.map((group) => (
									<FrontTableRow
										key={String(group.locale) + String(group.purpose)}
										className="border-t border-kumo-line"
									>
										{[
											"locale",
											"purpose",
											"messages",
											"sent",
											"delivered",
											"opens",
											"clicks",
											"failed",
										].map((key) => (
											<FrontTableCell key={key} className="p-3">
												{key === "purpose" || key === "locale" ? t(String(group[key])) : group[key]}
											</FrontTableCell>
										))}
									</FrontTableRow>
								))}
							</FrontTableBody>
						</FrontTable>
						{!data.groups.length && (
							<p className="p-5 text-kumo-subtle">{t("No deliveries in this period")}</p>
						)}
					</div>
				</>
			)}
		</section>
	);
}
