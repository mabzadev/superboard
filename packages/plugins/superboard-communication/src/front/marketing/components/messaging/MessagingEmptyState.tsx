"use client";

import { cn } from "@superboard/front-ui/lib/utils.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Plus, MessageSquare } from "lucide-react";

import { useStudioI18n } from "../../studio/i18n.js";

const MessagingEmptyState = ({
	onCreateMessage,
	isArchived,
}: {
	onCreateMessage?: () => void;
	isArchived?: boolean;
}) => {
	const { t } = useStudioI18n();
	return (
		<div
			role="status"
			aria-live="polite"
			className="flex flex-col items-center justify-center py-14 px-4 w-full bg-sidebar"
		>
			<div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted mb-4">
				<MessageSquare className="h-5 w-5 text-muted-foreground" />
			</div>

			<h3 className="text-sm font-semibold text-foreground text-center mb-2">
				{t(isArchived ? "No archived messages" : "No messages yet")}
			</h3>

			<p
				className={cn(
					"text-xs text-muted-foreground text-center leading-relaxed max-w-md",
					!isArchived && "mb-6",
				)}
			>
				{t(
					isArchived
						? "Messages you archive will appear here. Archived messages are no longer displayed to users but their engagement data is preserved."
						: "In-app messages let you reach users with announcements, promotions, or onboarding content. Create a message to engage your audience directly inside your app.",
				)}
			</p>

			{!isArchived && onCreateMessage && (
				<Button className="ps-3 pe-4" onClick={onCreateMessage}>
					<Plus className="h-4 w-4" />
					{t("Create Message")}
				</Button>
			)}
		</div>
	);
};

export default MessagingEmptyState;
