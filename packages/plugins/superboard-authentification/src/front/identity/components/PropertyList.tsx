import { cn } from "@superboard/front-ui/lib/utils.js";
import type { ComponentProps } from "react";

export function PropertyList({ className, ...props }: ComponentProps<"div">) {
	return <div className={cn("flex w-full flex-col divide-y", className)} {...props} />;
}

export function PropertyRow({
	className,
	inline = false,
	...props
}: ComponentProps<"div"> & { inline?: boolean }) {
	return (
		<div
			className={cn(
				inline
					? "flex items-center justify-between gap-4 py-4"
					: "flex flex-col gap-2 py-4",
				className,
			)}
			{...props}
		/>
	);
}

export function PropertyLabel({ className, ...props }: ComponentProps<"div">) {
	return <div className={cn("text-sm font-medium", className)} {...props} />;
}

export function PropertyValue({ className, ...props }: ComponentProps<"div">) {
	return <div className={cn("text-sm", className)} {...props} />;
}
