"use client";

import { TooltipTrigger } from "@radix-ui/react-tooltip";
import { Tooltip, TooltipContent } from "@superboard/front-ui/ui/tooltip.js";
import { formatCurrencyFromCents } from "@superboard/front-ui/utils/formatCurrency.js";
import { Info } from "lucide-react";

import { useAnalyticsI18n } from "../analytics/analytics-i18n.js";

export interface DashBoardCardType {
	title: string;
	value: string | number;
	valueType?: "money";
	tooltip?: string;
	note?: string;
}

function formatMainValue(card: DashBoardCardType, numberFormatter: Intl.NumberFormat) {
	if (typeof card.value === "string" && !Number.isFinite(Number(card.value))) return card.value;
	if (card.valueType === "money") {
		return `${formatCurrencyFromCents(Number(card.value))}`;
	}
	return numberFormatter.format(Number(card.value));
}

function CardContent({ card }: { card: DashBoardCardType }) {
	const { locale } = useAnalyticsI18n();
	const numberFormatter = new Intl.NumberFormat(locale);

	return (
		<>
			<div className="flex items-center gap-1.5 mb-3">
				<span className="text-sm text-muted-foreground">{card.title}</span>
				{card.tooltip && (
					<Tooltip>
						<TooltipTrigger>
							<Info className="h-3.5 w-3.5 text-muted-foreground/50" />
						</TooltipTrigger>
						<TooltipContent>
							<p>{card.tooltip}</p>
						</TooltipContent>
					</Tooltip>
				)}
			</div>

			<p className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
				{formatMainValue(card, numberFormatter)}
			</p>

			{card.note && <p className="mt-2 text-xs text-muted-foreground">{card.note}</p>}
		</>
	);
}

export function SectionCards({ cards }: { cards: DashBoardCardType[] }) {
	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
			{cards.map((card) => (
				<div
					key={card.title}
					className="relative rounded-md border border-sidebar-border bg-card p-5 transition-colors hover:border-border"
				>
					<CardContent card={card} />
				</div>
			))}
		</div>
	);
}
