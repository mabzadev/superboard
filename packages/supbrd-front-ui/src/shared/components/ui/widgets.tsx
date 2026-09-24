import * as React from "react";

import { cn } from "../../lib/utils.js";
import { Card } from "./card.js";

export interface StatCardProps extends React.ComponentProps<typeof Card> {
	title: string;
	value: React.ReactNode;
	icon?: React.ComponentType<{ className?: string }>;
	description?: React.ReactNode;
	change?: {
		value: string | number;
		trend?: "positive" | "negative" | "neutral";
	};
}

export function StatCard({
	title,
	value,
	icon: Icon,
	description,
	change,
	className,
	...props
}: StatCardProps) {
	return (
		<Card
			className={cn(
				"p-5 justify-between gap-3 bg-surface-100 border border-border rounded-lg shadow-xs",
				className,
			)}
			{...props}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="space-y-1">
					<span className="text-xs font-mono uppercase tracking-wider text-foreground-lighter">
						{title}
					</span>
					<div className="font-heading text-2xl font-bold tracking-tight text-foreground tabular-nums">
						{value}
					</div>
				</div>
				{Icon && (
					<div className="p-2 rounded-md bg-[#3ecf8e]/10 text-[#3ecf8e] shrink-0">
						<Icon className="size-4" />
					</div>
				)}
			</div>
			{(description || change) && (
				<div className="flex items-center gap-2 text-xs text-foreground-lighter">
					{change && (
						<span
							className={cn(
								"font-medium",
								change.trend === "positive" && "text-[#3ecf8e]",
								change.trend === "negative" && "text-destructive",
								change.trend === "neutral" && "text-foreground-lighter",
							)}
						>
							{change.value}
						</span>
					)}
					{description && <span>{description}</span>}
				</div>
			)}
		</Card>
	);
}

export function MetricsGrid({ className, children, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="metrics-grid"
			className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}
			{...props}
		>
			{children}
		</div>
	);
}

export function Toolbar({ className, children, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="toolbar"
			className={cn("flex flex-wrap items-center justify-between gap-3", className)}
			{...props}
		>
			{children}
		</div>
	);
}

export function Callout({
	title,
	description,
	children,
	icon: Icon,
	className,
	...props
}: {
	title?: React.ReactNode;
	description?: React.ReactNode;
	children?: React.ReactNode;
	icon?: React.ComponentType<{ className?: string }>;
} & React.ComponentProps<"div">) {
	return (
		<div
			data-slot="callout"
			className={cn(
				"flex items-start gap-3 rounded-lg border border-border bg-surface-100/50 p-4 text-sm text-foreground",
				className,
			)}
			{...props}
		>
			{Icon && <Icon className="size-5 shrink-0 text-foreground-lighter mt-0.5" />}
			<div className="space-y-1 flex-1">
				{title && <div className="font-medium text-foreground font-heading">{title}</div>}
				{description && (
					<div className="text-foreground-lighter text-xs leading-relaxed">{description}</div>
				)}
				{children}
			</div>
		</div>
	);
}

export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
	className,
	...props
}: {
	icon?: React.ComponentType<{ className?: string }>;
	title: React.ReactNode;
	description?: React.ReactNode;
	action?: React.ReactNode;
} & React.ComponentProps<"div">) {
	return (
		<div
			data-slot="empty-state"
			className={cn(
				"flex flex-col items-center justify-center text-center p-8 border border-dashed border-border rounded-lg bg-surface-100/30 space-y-3",
				className,
			)}
			{...props}
		>
			{Icon && (
				<div className="p-3 rounded-full bg-surface-200 text-foreground-lighter">
					<Icon className="size-6" />
				</div>
			)}
			<div className="space-y-1 max-w-sm">
				<h4 className="text-sm font-semibold text-foreground font-heading">{title}</h4>
				{description && (
					<p className="text-xs text-foreground-lighter leading-relaxed">{description}</p>
				)}
			</div>
			{action && <div className="pt-2">{action}</div>}
		</div>
	);
}

export function Timeline({ className, children, ...props }: React.ComponentProps<"ol">) {
	return (
		<ol
			data-slot="timeline"
			className={cn("relative border-s border-border ps-4 space-y-6", className)}
			{...props}
		>
			{children}
		</ol>
	);
}

export function TimelineItem({
	title,
	time,
	description,
	children,
	className,
	...props
}: {
	title: React.ReactNode;
	time?: React.ReactNode;
	description?: React.ReactNode;
	children?: React.ReactNode;
} & React.ComponentProps<"li">) {
	return (
		<li data-slot="timeline-item" className={cn("relative", className)} {...props}>
			<span className="absolute -start-[21px] top-1 flex size-2.5 rounded-full bg-primary ring-4 ring-background" />
			<div className="flex flex-col gap-1">
				<div className="flex items-center justify-between gap-2">
					<span className="text-sm font-medium text-foreground">{title}</span>
					{time && <span className="text-xs text-foreground-lighter">{time}</span>}
				</div>
				{description && <p className="text-xs text-foreground-lighter">{description}</p>}
				{children}
			</div>
		</li>
	);
}
