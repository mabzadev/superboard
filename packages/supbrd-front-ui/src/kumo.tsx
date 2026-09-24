import {
	Input as KumoInput,
	InputArea as KumoInputArea,
	Select as KumoSelect,
	Checkbox as KumoCheckbox,
	Dialog as KumoDialog,
	type ButtonProps,
	type LinkButtonProps,
} from "@cloudflare/kumo";
import { createElement, forwardRef, type ComponentProps, type ReactNode } from "react";

import { Button as FrontButton, buttonVariants } from "./shared/components/ui/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./shared/components/ui/tooltip.js";
import { cn } from "./shared/lib/utils.js";

export { Loader, Popover } from "@cloudflare/kumo";

const sizes = { xs: "tiny", sm: "sm", base: "default", lg: "lg" } as const;
const variants = {
	primary: "primary",
	secondary: "default",
	ghost: "ghost",
	destructive: "destructive",
	"secondary-destructive": "outline",
	outline: "outline",
} as const;

function isIconComponent(
	icon: ButtonProps["icon"],
): icon is Exclude<ButtonProps["icon"], ReactNode> {
	return (
		typeof icon === "function" ||
		Boolean(
			icon &&
			typeof icon === "object" &&
			"$$typeof" in icon &&
			icon.$$typeof === Symbol.for("react.forward_ref"),
		)
	);
}

function renderIcon(icon: ButtonProps["icon"]) {
	return isIconComponent(icon) ? createElement(icon, { size: 16, "aria-hidden": true }) : icon;
}

function shapeClass(shape: ButtonProps["shape"], size: keyof typeof sizes) {
	if (!shape || shape === "base") return undefined;
	return cn(
		"p-0",
		{ xs: "size-[26px]", sm: "size-7", base: "size-[34px]", lg: "size-10" }[size],
		shape === "circle" && "rounded-full",
	);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	({ variant = "secondary", size = "base", shape, icon, title, className, ...props }, ref) => {
		const button = (
			<FrontButton
				{...props}
				ref={ref}
				variant={variants[variant]}
				size={sizes[size]}
				icon={renderIcon(icon)}
				title={typeof title === "string" ? title : undefined}
				className={cn(
					shapeClass(shape, size),
					variant === "secondary-destructive" && "text-destructive",
					className,
				)}
			/>
		);
		return title && typeof title !== "string" ? (
			<Tooltip>
				<TooltipTrigger asChild>{button}</TooltipTrigger>
				<TooltipContent>{title}</TooltipContent>
			</Tooltip>
		) : (
			button
		);
	},
);
Button.displayName = "FrontCompatibleButton";

export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(
	(
		{
			variant = "secondary",
			size = "base",
			shape,
			icon,
			external,
			linksExternal,
			className,
			children,
			...props
		},
		ref,
	) => (
		<a
			{...props}
			ref={ref}
			data-slot="button"
			target={external || linksExternal ? "_blank" : props.target}
			rel={external || linksExternal ? "noopener noreferrer" : props.rel}
			className={cn(
				buttonVariants({ variant: variants[variant], size: sizes[size] }),
				shapeClass(shape, size),
				variant === "secondary-destructive" && "text-destructive",
				className,
			)}
		>
			{renderIcon(icon)}
			{children}
		</a>
	),
);
LinkButton.displayName = "FrontCompatibleLinkButton";

export const Input = forwardRef<HTMLInputElement, ComponentProps<typeof KumoInput>>(
	({ className, ...props }, ref) => (
		<KumoInput {...props} ref={ref} className={cn("front-input", className)} />
	),
);
Input.displayName = "FrontCompatibleInput";

export const InputArea = forwardRef<HTMLTextAreaElement, ComponentProps<typeof KumoInputArea>>(
	({ className, ...props }, ref) => (
		<KumoInputArea {...props} ref={ref} className={cn("front-input front-textarea", className)} />
	),
);
InputArea.displayName = "FrontCompatibleInputArea";

const FrontCheckbox = forwardRef<HTMLButtonElement, ComponentProps<typeof KumoCheckbox>>(
	({ label, ...props }, ref) => (
		<KumoCheckbox
			{...props}
			ref={ref}
			label={label ? <span className="text-sm leading-5">{label}</span> : label}
		/>
	),
);
FrontCheckbox.displayName = "FrontCompatibleCheckbox";
export const Checkbox = Object.assign(FrontCheckbox, {
	Item: KumoCheckbox.Item,
	Group: KumoCheckbox.Group,
	Legend: KumoCheckbox.Legend,
});

function FrontDialog({ className, ...props }: ComponentProps<typeof KumoDialog>) {
	return <KumoDialog {...props} className={cn("front-dialog", className)} />;
}
export const Dialog = Object.assign(FrontDialog, KumoDialog);

function FrontSelect<T, Multiple extends boolean | undefined = false>({
	className,
	...props
}: ComponentProps<typeof KumoSelect<T, Multiple>>) {
	return <KumoSelect<T, Multiple> {...props} className={cn("front-select", className)} />;
}

export const Select = Object.assign(FrontSelect, {
	Option: KumoSelect.Option,
	Group: KumoSelect.Group,
	GroupLabel: KumoSelect.GroupLabel,
	Separator: KumoSelect.Separator,
});
