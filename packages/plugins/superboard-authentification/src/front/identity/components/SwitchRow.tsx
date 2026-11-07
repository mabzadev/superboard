import { useId, type ComponentProps, type ReactNode } from "react";

import { Label } from "./ui/label.js";
import { Switch } from "./ui/switch.js";

export default function SwitchRow({
	label,
	description,
	id,
	...props
}: ComponentProps<typeof Switch> & { label: ReactNode; description?: ReactNode }) {
	const generated = useId();
	const controlId = id ?? generated;
	return (
		<div className="flex items-center justify-between gap-4">
			<div className="min-w-0 space-y-0.5">
				<Label htmlFor={controlId}>{label}</Label>
				{description && <p className="text-xs text-kumo-subtle">{description}</p>}
			</div>
			<Switch id={controlId} {...props} />
		</div>
	);
}
