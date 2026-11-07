import { zodResolver } from "@hookform/resolvers/zod";
import { ADMIN_ROLE, MEMBER_ROLE } from "@superboard/front-ui/constants/OptionsConstants.js";
import { cn } from "@superboard/front-ui/lib/utils.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superboard/front-ui/ui/dialog.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superboard/front-ui/ui/select.js";
import { useEffect, useId, type ChangeEvent } from "react";
import { useForm } from "react-hook-form";

import { useSettingsI18n } from "../../i18n.js";
import { addMemberSchema, type AddMemberFormValues } from "../../schemas/member.js";

const AddNewMemberDialog = ({
	open,
	onOpenChange,
	handleInviteMember,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	handleInviteMember: (email: string, role: string) => void;
}) => {
	const { t } = useSettingsI18n();
	const emailId = useId();
	const roleId = useId();
	const form = useForm<AddMemberFormValues>({
		resolver: zodResolver(addMemberSchema),
		defaultValues: { email: "", role: MEMBER_ROLE },
		mode: "onChange",
	});

	const email = form.watch("email") ?? "";
	const role = form.watch("role");
	const isEmailFieldValid = !form.formState.errors.email && email.length > 0;

	const handleEmailChange = (event: ChangeEvent<HTMLInputElement>) => {
		form.setValue("email", event.target.value, {
			shouldDirty: true,
			shouldTouch: true,
			shouldValidate: true,
		});
	};

	useEffect(() => {
		if (!open) {
			form.reset();
		}
	}, [open, form]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex w-full max-w-lg flex-col gap-5">
				<DialogHeader>
					<DialogTitle>{t("invite.title")}</DialogTitle>
					<DialogDescription>{t("invite.description")}</DialogDescription>
				</DialogHeader>
				<div className="space-y-2">
					<Label htmlFor={emailId}>{t("invite.email")}</Label>
					<Input
						id={emailId}
						type="email"
						autoComplete="off"
						className={cn(
							"w-full transition-all",
							isEmailFieldValid ? "border-valid-green ring-[2px] ring-valid-green/5" : "",
						)}
						name="email"
						value={email}
						onChange={handleEmailChange}
						onBlur={() => form.trigger("email")}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor={roleId}>{t("invite.role")}</Label>
					<Select
						value={role}
						onValueChange={(value) => form.setValue("role", value, { shouldValidate: true })}
					>
						<SelectTrigger id={roleId} className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ADMIN_ROLE}>{t("team.administrator")}</SelectItem>
							<SelectItem value={MEMBER_ROLE}>{t("team.memberRole")}</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="outline">{t("invite.cancel")}</Button>
					</DialogClose>
					<Button
						disabled={!form.formState.isValid}
						onClick={() => handleInviteMember(email, role)}
					>
						{t("invite.submit")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

export default AddNewMemberDialog;
