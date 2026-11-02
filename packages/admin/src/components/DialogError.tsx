import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { cn } from "../lib/utils.js";

export function getMutationError(error: unknown): string | null {
	if (!error) return null;
	if (error instanceof Error) return error.message;
	return i18n._(msg`An error occurred`);
}

export function DialogError({
	message,
	className,
}: {
	message?: string | null;
	className?: string;
}) {
	if (!message) return null;
	const lines = message.split("\n");
	return (
		<div
			role="alert"
			className={cn("rounded-md bg-kumo-danger/10 p-3 text-sm text-kumo-danger", className)}
		>
			{lines.map((line, i) => (
				<div key={i}>{line}</div>
			))}
		</div>
	);
}
