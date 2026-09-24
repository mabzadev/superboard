import * as React from "react";

import { cn } from "../../lib/utils.js";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
	sizeVariant?: "tiny" | "small" | "medium" | "large";
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
	({ className, type, sizeVariant = "small", ...props }, ref) => {
		const sizeClasses = {
			tiny: "h-[26px] text-xs px-2.5 py-1",
			small: "h-[34px] text-xs md:text-sm px-3 py-1.5",
			medium: "h-[38px] text-sm px-3.5 py-2",
			large: "h-[42px] text-base px-4 py-2.5",
		};

		return (
			<input
				ref={ref}
				type={type}
				data-slot="input"
				className={cn(
					"flex w-full rounded-md border border-control hover:border-control-hover bg-field px-3 py-1.5 text-sm text-foreground file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-foreground-muted focus:border-control-hover focus-ring disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-200 outline-none",
					"aria-[invalid=true]:bg-destructive/10 aria-[invalid=true]:border-destructive",
					sizeClasses[sizeVariant],
					className,
				)}
				{...props}
			/>
		);
	},
);
Input.displayName = "Input";

export { Input };
