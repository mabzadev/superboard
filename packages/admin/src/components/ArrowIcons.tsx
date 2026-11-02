import { ArrowRightIcon, CaretRightIcon, type IconProps } from "@phosphor-icons/react";

import { cn } from "../lib/utils";

export function CaretNext({ className, ...props }: IconProps) {
	return <CaretRightIcon className={cn("rtl:-scale-x-100", className)} {...props} />;
}

export function CaretPrev({ className, ...props }: IconProps) {
	return <CaretRightIcon className={cn("rotate-180 rtl:rotate-0", className)} {...props} />;
}

export function ArrowNext({ className, ...props }: IconProps) {
	return <ArrowRightIcon className={cn("rtl:-scale-x-100", className)} {...props} />;
}

export function ArrowPrev({ className, ...props }: IconProps) {
	return <ArrowRightIcon className={cn("rotate-180 rtl:rotate-0", className)} {...props} />;
}
