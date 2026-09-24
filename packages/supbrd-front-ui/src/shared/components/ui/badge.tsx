import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../../lib/utils.js";

const badgeVariants = cva(
	"inline-flex items-center gap-1 justify-center rounded-md whitespace-nowrap font-normal text-xs leading-4 px-2.5 py-1 shrink-0 [&>svg]:size-3 [&>svg]:pointer-events-none transition-colors",
	{
		variants: {
			variant: {
				default: "bg-surface-200 text-foreground-light border border-strong",
				brand: "bg-brand/10 text-brand-link border border-border-brand",
				success: "bg-brand/10 text-brand-link border border-border-brand",
				warning: "bg-warning/10 text-warning border border-border-warning",
				destructive: "bg-destructive/15 text-destructive border border-destructive/30",
				info: "bg-info/10 text-info border border-border-info",
				secondary: "bg-secondary text-secondary-foreground border-transparent",
				outline: "border border-border text-foreground bg-transparent",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

export interface BadgeProps
	extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
	asChild?: boolean;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
	({ className, variant = "default", asChild = false, children, ...props }, ref) => {
		const Comp = asChild ? Slot : "span";

		return (
			<Comp
				ref={ref}
				data-slot="badge"
				className={cn(badgeVariants({ variant }), className)}
				{...props}
			>
				{children}
			</Comp>
		);
	},
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
