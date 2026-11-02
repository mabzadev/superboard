import * as React from "react";

import { cn } from "../lib/utils";

export interface EditorHeaderProps {
	leading?: React.ReactNode;
	children: React.ReactNode;
	actions?: React.ReactNode;
	className?: string;
}

export function EditorHeader({ leading, children, actions, className }: EditorHeaderProps) {
	return (
		<div
			data-editor-header
			className={cn("flex flex-wrap items-center justify-between gap-y-2 gap-x-4", className)}
		>
			<div className="flex items-center gap-4 min-w-0">
				{leading}
				<div className="min-w-0">{children}</div>
			</div>
			{actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
		</div>
	);
}

export default EditorHeader;
