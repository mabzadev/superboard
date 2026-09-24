import { useFrontContext } from "@superboard/front-ui/context";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { Select, Popover } from "@superboard/front-ui/kumo";
import { useTheme } from "@superboard/front-ui/theme";
import { Button } from "@superboard/front-ui/ui";
import { useState } from "react";

import { localizeFrontPath, type UserFrontLocale } from "../lib/user-front-i18n.js";

export function NativeFrontControls({
	message,
	locale,
	actions,
}: {
	message(id: string, values?: Record<string, string>): string;
	locale: UserFrontLocale;
	actions: readonly { label: string; href: string }[];
}) {
	const { operator, activePluginIds, instanceId, deployment } = useFrontContext();
	const { selectedInstance, selectedProject, projectType, setProjectType, ready } =
		useProjectSelection();
	const { resolvedTheme, setTheme } = useTheme();
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	if (!operator) return null;
	const name = operator.name || operator.email;
	async function logout() {
		setBusy(true);
		setError(false);
		const result = await fetch("/_emdash/api/auth/logout", {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
			body: "{}",
		});
		if (!result.ok) throw new Error("Logout failed");
		window.location.assign("/_emdash/admin/login");
	}
	return (
		<div className="native-front-controls">
			<span className="native-front-instance-name">
				{deployment?.application ?? selectedInstance?.name ?? instanceId}
			</span>
			{ready !== false && selectedProject && (
				<select
					aria-label={message("site.front.project_data")}
					value={projectType}
					onChange={(event) => {
						setProjectType(event.target.value);
					}}
				>
					<option value="production">{message("site.front.production")}</option>
					<option value="test">{message("site.front.test")}</option>
				</select>
			)}
			{error && <p role="alert">{message("site.front.logout_failed")}</p>}
			<Popover open={open} onOpenChange={setOpen}>
				<Popover.Trigger
					aria-label={message("site.front.open_account", { name })}
					render={<Button variant="ghost" size="icon" />}
				>
					<span>{name.slice(0, 1).toUpperCase()}</span>
				</Popover.Trigger>
				<Popover.Content align="end" className="native-front-account-menu">
					<Popover.Title>{name}</Popover.Title>
					<Select<UserFrontLocale>
						aria-label={message("site.front.language")}
						value={locale}
						items={{
							en: message("site.front.language.en"),
							fr: message("site.front.language.fr"),
						}}
						onValueChange={(value: UserFrontLocale | null) => {
							if (!value || value === locale) return;
							const url = new URL(window.location.href);
							url.pathname = localizeFrontPath(url.pathname, value);
							url.searchParams.set("lang", value);
							window.location.assign(url.href);
						}}
					/>
					{actions.map((action) => (
						<a key={action.href} href={action.href}>
							{message(action.label)}
						</a>
					))}
					{activePluginIds.includes("supbrd-plug-user") && (
						<a href="/auth/account">{message("site.front.account")}</a>
					)}
					{activePluginIds.includes("supbrd-plug-settings") && (
						<a href="/core/settings">{message("site.front.project_settings")}</a>
					)}
					<Button
						variant="ghost"
						onClick={() => {
							setTheme(resolvedTheme === "dark" ? "light" : "dark");
							setOpen(false);
						}}
					>
						{message(resolvedTheme === "dark" ? "site.front.light_mode" : "site.front.dark_mode")}
					</Button>
					<Button
						variant="ghost"
						disabled={busy}
						onClick={() => {
							logout().catch(() => {
								setError(true);
								setBusy(false);
							});
						}}
					>
						{message("site.front.logout")}
					</Button>
				</Popover.Content>
			</Popover>
		</div>
	);
}
