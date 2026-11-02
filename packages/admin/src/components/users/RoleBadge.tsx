import { Badge } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";
import { getRoleConfig } from "./roleDefinitions.js";

export type { RoleLevelConfig } from "./roleDefinitions.js";

type BadgeVariant = ComponentProps<typeof Badge>["variant"];

export interface RoleBadgeProps {
	role: number;
	size?: "sm" | "md";
	showDescription?: boolean;
	className?: string;
}

const ROLE_VARIANTS: Record<string, BadgeVariant> = {
	gray: "neutral",
	blue: "blue",
	green: "green",
	purple: "purple",
	red: "red",
};

export function RoleBadge({
	role,
	size = "sm",
	showDescription = false,
	className,
}: RoleBadgeProps) {
	const { t } = useLingui();
	const config = getRoleConfig(role);

	const sizeClasses = {
		sm: "text-xs",
		md: "px-2.5 py-1 text-sm",
	};

	return (
		<span title={showDescription ? undefined : t(config.description)}>
			<Badge
				variant={ROLE_VARIANTS[config.color] ?? "neutral"}
				className={cn(sizeClasses[size], className)}
			>
				{t(config.label)}
				{showDescription && <span className="ms-1 opacity-75">- {t(config.description)}</span>}
			</Badge>
		</span>
	);
}
