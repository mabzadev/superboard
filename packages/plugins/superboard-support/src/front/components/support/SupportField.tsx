import { Label } from "@superboard/front-ui/ui/label.js";
import { cloneElement, useId, type ReactElement } from "react";

export function SupportField({
	label,
	children,
}: {
	label: string;
	children: ReactElement<{ id?: string }>;
}) {
	const id = useId();
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			{cloneElement(children, { id })}
		</div>
	);
}
