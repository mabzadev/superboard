import { cn } from "@superboard/front-ui/lib/utils.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { AlertCircle } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import type { MessageFormValues } from "../../schemas/message.js";
import { useStudioI18n } from "../../studio/i18n.js";

const CreateMessageOverview = ({
	form,
	readOnly,
	showErrors,
}: {
	form: UseFormReturn<MessageFormValues>;
	readOnly?: boolean;
	showErrors?: boolean;
}) => {
	const { t } = useStudioI18n();
	const title = form.watch("title");
	const subtitle = form.watch("subtitle");

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<label className="text-sm font-medium">{t("Title")}</label>
					<Badge
						variant="outline"
						className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground"
					>
						{t("Required")}
					</Badge>
				</div>
				<Input
					readOnly={readOnly}
					placeholder={t("Enter the title of the message")}
					aria-label={t("Title")}
					{...form.register("title")}
					className={cn(
						"transition-all",
						title.length > 0
							? "border-valid-green/30 ring-[2px] ring-valid-green/5"
							: showErrors
								? "border-destructive/50 ring-[3px] ring-destructive/10"
								: "border-amber-300/50 ring-[2px] ring-amber-200/10",
					)}
				/>
				{showErrors && title.length === 0 && (
					<Badge variant="destructive" className="w-fit gap-1.5 py-1 px-2.5">
						<AlertCircle className="h-3 w-3" />
						{t("Title is required")}
					</Badge>
				)}
				<span className="text-xs text-muted-foreground">
					{t(
						"This will be used as a title of the push notification, and will be shown in the messages list.",
					)}
				</span>
			</div>

			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<label className="text-sm font-medium">{t("Subtitle")}</label>
					<Badge
						variant="outline"
						className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground"
					>
						{t("Required")}
					</Badge>
				</div>
				<Input
					readOnly={readOnly}
					placeholder={t("Enter the subtitle of the message")}
					aria-label={t("Subtitle")}
					{...form.register("subtitle")}
					className={cn(
						"transition-all",
						subtitle.length > 0
							? "border-valid-green/30 ring-[2px] ring-valid-green/5"
							: showErrors
								? "border-destructive/50 ring-[3px] ring-destructive/10"
								: "border-amber-300/50 ring-[2px] ring-amber-200/10",
					)}
				/>
				{showErrors && subtitle.length === 0 && (
					<Badge variant="destructive" className="w-fit gap-1.5 py-1 px-2.5">
						<AlertCircle className="h-3 w-3" />
						{t("Subtitle is required")}
					</Badge>
				)}
				<span className="text-xs text-muted-foreground">
					{t(
						"This will be used as a subtitle of the push notification, and will be shown in the messages list.",
					)}
				</span>
			</div>
		</div>
	);
};

export default CreateMessageOverview;
