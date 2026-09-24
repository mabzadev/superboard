import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
	"relative inline-flex items-center justify-center gap-2 whitespace-nowrap text-center font-normal ease-out duration-200 rounded-md transition-[background-color,border-color,color,scale] [&:not([aria-haspopup])]:motion-safe:active:scale-[0.98] focus-ring border cursor-pointer disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				primary:
					"bg-brand-400 dark:bg-brand-500 hover:bg-brand/80 dark:hover:bg-brand/50 text-foreground border-brand-500/75 dark:border-brand/30 hover:border-brand-600 dark:hover:border-brand",
				default:
					"text-foreground bg-background dark:bg-card hover:bg-popover border-strong hover:border-control-hover",
				secondary: "bg-foreground text-background hover:opacity-90 border-foreground-light",
				outline:
					"text-foreground bg-transparent border-strong hover:border-foreground-muted hover:bg-accent",
				dashed:
					"text-foreground border border-dashed border-strong hover:border-control-hover bg-transparent",
				ghost: "text-foreground hover:bg-accent border-transparent shadow-none",
				text: "text-foreground hover:bg-accent border-transparent shadow-none",
				link: "text-brand-link border-transparent hover:underline shadow-none p-0 h-auto",
				danger:
					"text-destructive-foreground bg-destructive hover:bg-destructive/90 border-destructive",
				destructive:
					"text-destructive-foreground bg-destructive hover:bg-destructive/90 border-destructive",
				warning: "text-warning-foreground bg-warning hover:bg-warning/90 border-warning",
			},
			size: {
				tiny: "text-xs px-2.5 py-1 h-[26px]",
				small: "text-xs md:text-sm px-3 py-1.5 h-[34px]",
				medium: "text-sm px-4 py-2 h-[38px]",
				large: "text-base px-5 py-2.5 h-[42px]",
				xlarge: "text-base px-6 py-3 h-[50px]",
				default: "text-xs md:text-sm px-3.5 py-1.5 h-[34px]",
				sm: "text-xs px-2.5 py-1 h-[28px]",
				lg: "text-base px-5 py-2 h-[40px]",
				icon: "size-[34px] p-0",
				"icon-sm": "size-[28px] p-0",
			},
			block: {
				true: "w-full flex items-center justify-center",
			},
			rounded: {
				true: "rounded-full",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
	asChild?: boolean;
	loading?: boolean;
	icon?: React.ReactNode;
	iconRight?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{
			className,
			variant,
			size,
			block,
			rounded,
			asChild = false,
			loading = false,
			icon,
			iconRight,
			children,
			disabled,
			...props
		},
		ref,
	) => {
		const Comp = asChild ? Slot : "button";

		const inactive = disabled || loading;
		if (asChild) {
			return (
				<Comp
					{...props}
					ref={ref}
					data-slot="button"
					aria-disabled={inactive || undefined}
					aria-busy={loading || undefined}
					tabIndex={inactive ? -1 : props.tabIndex}
					onClickCapture={(event) => {
						if (inactive) {
							event.preventDefault();
							event.stopPropagation();
							return;
						}
						props.onClickCapture?.(event);
					}}
					className={cn(buttonVariants({ variant, size, block, rounded, className }))}
				>
					{loading ? <Loader2 aria-hidden="true" className="animate-spin size-4" /> : icon}
					<Slottable>{children}</Slottable>
					{iconRight}
				</Comp>
			);
		}

		return (
			<button
				ref={ref}
				data-slot="button"
				type="button"
				disabled={inactive}
				aria-busy={loading || undefined}
				className={cn(buttonVariants({ variant, size, block, rounded, className }))}
				{...props}
			>
				{loading ? <Loader2 className="animate-spin size-4" /> : icon}
				{children}
				{iconRight}
			</button>
		);
	},
);
Button.displayName = "Button";

export { Button, buttonVariants };
