import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../../lib/utils.js";

const alertVariants = cva(
	"relative w-full text-sm rounded-lg border p-4 [&>svg~*]:pl-8 [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:size-5 [&>svg]:text-foreground",
	{
		variants: {
			variant: {
				default: "bg-surface-200/30 border-border text-foreground",
				destructive:
					"bg-destructive/10 border-destructive/30 text-foreground [&>svg]:text-destructive",
				warning: "bg-amber-500/10 border-amber-500/30 text-foreground [&>svg]:text-amber-500",
				success: "bg-[#3ecf8e]/10 border-[#3ecf8e]/30 text-foreground [&>svg]:text-[#3ecf8e]",
				info: "bg-blue-500/10 border-blue-500/30 text-foreground [&>svg]:text-blue-500",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

const Alert = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
	<div
		ref={ref}
		data-slot="alert"
		role="alert"
		className={cn(alertVariants({ variant }), className)}
		{...props}
	/>
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
	({ className, children, ...props }, ref) => (
		<h5
			ref={ref}
			data-slot="alert-title"
			className={cn(
				"!mt-0 mb-1 font-semibold tracking-tight text-foreground font-heading",
				className,
			)}
			{...props}
		>
			{children}
		</h5>
	),
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div
			ref={ref}
			data-slot="alert-description"
			className={cn(
				"text-xs text-foreground-lighter leading-relaxed [&_p]:leading-relaxed",
				className,
			)}
			{...props}
		/>
	),
);
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
