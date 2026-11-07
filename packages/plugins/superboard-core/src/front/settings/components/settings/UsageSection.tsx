"use client";

import {
	DateRangePicker,
	type Preset,
} from "@superboard/front-ui/components/dateRangePicker/DateRangePicker.js";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { Download } from "@superboard/front-ui/icons";
import { formatApiDate } from "@superboard/front-ui/lib/dateUtils.js";
import {
	showGenericError,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import SessionStorage from "@superboard/front-ui/lib/SessionStorage.js";
import dynamic from "@superboard/front-ui/next-dynamic";
import { SettingsActions, SettingsRow, SettingsSection } from "@superboard/front-ui/settings-form";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Skeleton } from "@superboard/front-ui/ui/skeleton.js";
import { useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";

import { useExportUsageMutation } from "../../hooks/mutations/useInstanceMutations.js";
import { useEventsPaymentQuery } from "../../hooks/queries/useEventQueries.js";
import { useSettingsI18n } from "../../i18n.js";

const SettingsActiveUsersChart = dynamic(() => import("./SettingsActiveUsersChart.js"), {
	ssr: false,
	loading: () => <Skeleton className="h-[200px] w-full rounded-md" />,
});

function savedDate(range: unknown, key: "from" | "to") {
	if (typeof range !== "object" || range === null) return undefined;
	const value: unknown = Reflect.get(range, key);
	return typeof value === "string" && value ? value : undefined;
}

function initialDateRange(): DateRange {
	try {
		const saved = SessionStorage.getDateFilter();
		if (saved) {
			const range: unknown = JSON.parse(saved);
			const from = savedDate(range, "from");
			const to = savedDate(range, "to");
			return {
				from: from ? new Date(from) : undefined,
				to: to ? new Date(to) : undefined,
			};
		}
	} catch {}
	const to = new Date();
	const from = new Date();
	from.setDate(to.getDate() - 30);
	return { from, to };
}

export default function UsageSection() {
	const { t } = useSettingsI18n();
	const { selectedInstance } = useProjectSelection();
	const exportUsageMutation = useExportUsageMutation();
	const [dateRange, setDateRange] = useState<DateRange | undefined>(initialDateRange);

	const eventsPaymentParams = useMemo(() => {
		if (!selectedInstance || !dateRange?.from || !dateRange?.to) return null;
		return {
			start_date: formatApiDate(dateRange.from),
			end_date: formatApiDate(dateRange.to),
		};
	}, [selectedInstance, dateRange]);
	const eventsPaymentQuery = useEventsPaymentQuery(selectedInstance?.id, eventsPaymentParams);

	useEffect(() => {
		if (eventsPaymentQuery.error) showGenericError();
	}, [eventsPaymentQuery.error]);

	const dateRangePresets: Preset[] = [
		{ label: t("usage.last7Days"), value: 7, duration: "days" },
		{ label: t("usage.last30Days"), value: 30, duration: "days" },
		{ label: t("usage.last3Months"), value: 3, duration: "months" },
	];

	const handleDateChange = (range: DateRange | undefined) => {
		setDateRange(range);
		if (range) SessionStorage.setDateFilter(JSON.stringify(range));
	};

	const handleExport = async () => {
		if (!selectedInstance || !dateRange?.from || !dateRange.to) return;
		try {
			const response = await exportUsageMutation.mutateAsync({
				id: selectedInstance.id,
				data: {
					start_date: formatApiDate(dateRange.from),
					end_date: formatApiDate(dateRange.to),
				},
			});
			showSuccessNotification(response.data.message);
		} catch {
			showGenericError();
		}
	};

	return (
		<div className="flex max-w-3xl flex-col gap-4 py-4">
			<SettingsSection title={t("usage.title")} description={t("usage.description")}>
				<SettingsRow>
					<DateRangePicker date={dateRange} setDate={handleDateChange} presets={dateRangePresets} />
					<SettingsActiveUsersChart data={eventsPaymentQuery.data ?? null} />
				</SettingsRow>
			</SettingsSection>
			<SettingsActions>
				<Button variant="outline" size="sm" onClick={() => void handleExport()}>
					<Download className="size-3.5" />
					{t("usage.export")}
				</Button>
			</SettingsActions>
		</div>
	);
}
