import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils.js";
import { type ButtonProps, buttonVariants } from "./button.js";

type PaginationProps = React.ComponentProps<"nav"> & {
	label?: string;
};

const Pagination = ({ className, label, ...props }: PaginationProps) => (
	<nav
		role="navigation"
		aria-label={label}
		className={cn("mx-auto flex w-full justify-center", className)}
		{...props}
	/>
);
Pagination.displayName = "Pagination";

const PaginationContent = React.forwardRef<HTMLUListElement, React.ComponentProps<"ul">>(
	({ className, ...props }, ref) => (
		<ul ref={ref} className={cn("flex flex-row items-center gap-1", className)} {...props} />
	),
);
PaginationContent.displayName = "PaginationContent";

const PaginationItem = React.forwardRef<HTMLLIElement, React.ComponentProps<"li">>(
	({ className, ...props }, ref) => <li ref={ref} className={cn("", className)} {...props} />,
);
PaginationItem.displayName = "PaginationItem";

type PaginationLinkProps = {
	isActive?: boolean;
} & Pick<ButtonProps, "size"> &
	React.ComponentProps<"a">;

const PaginationLink = ({
	className,
	isActive,
	size = "icon",
	children,
	...props
}: PaginationLinkProps) => (
	<a
		aria-current={isActive ? "page" : undefined}
		className={cn(
			buttonVariants({
				variant: isActive ? "outline" : "ghost",
				size,
			}),
			className,
		)}
		{...props}
	>
		{children}
	</a>
);
PaginationLink.displayName = "PaginationLink";

type PaginationPreviousProps = React.ComponentProps<typeof PaginationLink> & {
	label?: string;
};

const PaginationPrevious = ({ className, label, ...props }: PaginationPreviousProps) => (
	<PaginationLink
		aria-label={label}
		size="default"
		className={cn("gap-1 ps-2.5", className)}
		{...props}
	>
		<ChevronLeft className="h-4 w-4 rtl:rotate-180" />
		{label != null && <span>{label}</span>}
	</PaginationLink>
);
PaginationPrevious.displayName = "PaginationPrevious";

type PaginationNextProps = React.ComponentProps<typeof PaginationLink> & {
	label?: string;
};

const PaginationNext = ({ className, label, ...props }: PaginationNextProps) => (
	<PaginationLink
		aria-label={label}
		size="default"
		className={cn("gap-1 pe-2.5", className)}
		{...props}
	>
		{label != null && <span>{label}</span>}
		<ChevronRight className="h-4 w-4 rtl:rotate-180" />
	</PaginationLink>
);
PaginationNext.displayName = "PaginationNext";

type PaginationEllipsisProps = React.ComponentProps<"span"> & {
	moreLabel?: string;
};

const PaginationEllipsis = ({ className, moreLabel, ...props }: PaginationEllipsisProps) => (
	<span
		aria-hidden
		className={cn("flex h-9 w-9 items-center justify-center", className)}
		{...props}
	>
		<MoreHorizontal className="h-4 w-4" />
		{moreLabel != null && <span className="sr-only">{moreLabel}</span>}
	</span>
);
PaginationEllipsis.displayName = "PaginationEllipsis";

export {
	Pagination,
	PaginationContent,
	PaginationLink,
	PaginationItem,
	PaginationPrevious,
	PaginationNext,
	PaginationEllipsis,
};
