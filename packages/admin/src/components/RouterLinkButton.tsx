import { type LinkButtonProps, buttonVariants } from "@cloudflare/kumo";
import { type Icon } from "@phosphor-icons/react";
import { Link, type LinkProps } from "@tanstack/react-router";
import * as React from "react";

import { cn } from "../lib/utils";

type ButtonStyleProps = Pick<LinkButtonProps, "variant" | "size" | "shape" | "icon">;

export type RouterLinkButtonProps = Omit<LinkProps, "children"> &
	ButtonStyleProps & {
		className?: string;
		children?: React.ReactNode;
		onClick?: React.MouseEventHandler<HTMLAnchorElement>;
	};

export function RouterLinkButton({
	className,
	variant,
	size,
	shape,
	icon,
	children,
	...linkProps
}: RouterLinkButtonProps) {
	const iconNode = renderIcon(icon);
	return (
		<Link
			{...(linkProps as LinkProps)}
			className={cn(
				buttonVariants({ variant, size, shape }),
				"flex items-center no-underline!",
				className,
			)}
		>
			{iconNode}
			{children}
		</Link>
	);
}

function renderIcon(icon: Icon | React.ReactNode | undefined): React.ReactNode {
	if (!icon) return null;
	if (React.isValidElement(icon)) return icon;
	const Comp = icon as React.ComponentType<Record<string, unknown>>;
	return <Comp />;
}
