import { useFrontContext } from "@superboard/front-ui/context";
import { Select } from "@superboard/front-ui/kumo";
import { useTheme } from "@superboard/front-ui/theme";
import { useState } from "react";

import { Button } from "../../../../packages/supbrd-front-ui/src/shared/components/ui/button.js";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "../../../../packages/supbrd-front-ui/src/shared/components/ui/popover.js";
import { useProjectSelection } from "../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js";
import { localizeFrontPath, type UserFrontLocale } from "../lib/user-front-i18n.js";

export function NativeFrontControls({
	message,
	locale,
}: {
	message(id: string, values?: Record<string, string>): string;
	locale: UserFrontLocale;
}) {
	const { operator, activePluginIds, instanceId, deployment, environments } = useFrontContext();
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
		try {
			const result = await fetch("/_emdash/api/auth/logout", {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
				body: "{}",
			});
			if (!result.ok) throw new Error("Logout failed");
			window.location.assign("/_emdash/admin/login");
		} catch {
			setError(true);
			setBusy(false);
		}
	}
	return (
		<div className="native-front-controls">
			<Select<UserFrontLocale>
				aria-label={message("site.front.language")}
				value={locale}
				items={{
					en: message("site.front.language.en"),
					fr: message("site.front.language.fr"),
				}}
				onValueChange={(value) => {
					if (!value || value === locale) return;
					const url = new URL(window.location.href);
					url.pathname = localizeFrontPath(url.pathname, value);
					url.searchParams.set("lang", value);
					window.location.assign(url.href);
				}}
			/>
			<span className="native-front-instance-name">
				{deployment?.application ?? selectedInstance?.name ?? instanceId}
			</span>
			{deployment && (
				<div className="native-front-deployment">
					{environments && environments.length > 1 ? (
						<select
							aria-label={message("site.front.environment")}
							value={deployment.id}
							onChange={(event) => {
								const target = environments.find(({ id }) => id === event.target.value);
								if (target && target.id !== deployment.id) {
									const url = new URL("/superboard-system/home", target.consoleUrl);
									url.searchParams.set("lang", locale);
									window.location.assign(url.href);
								}
							}}
						>
							{environments.map((entry) => (
								<option key={entry.id} value={entry.id}>
									{entry.label === entry.environment
										? message(`site.front.deployment.${entry.environment}`)
										: entry.label}
								</option>
							))}
						</select>
					) : (
						<span>
							{deployment.label === deployment.environment
								? message(`site.front.deployment.${deployment.environment}`)
								: deployment.label}
						</span>
					)}
					<code title={deployment.apiUrl}>{deployment.apiUrl}</code>
				</div>
			)}
			{ready !== false && selectedProject && (
				<label className="native-front-project-data">
					<span>{message("site.front.project_data")}</span>
					<select
						aria-label={message("site.front.project_data")}
						value={projectType}
						onChange={(event) => setProjectType(event.target.value)}
					>
						<option value="production">{message("site.front.production")}</option>
						<option value="test">{message("site.front.test")}</option>
					</select>
				</label>
			)}
			{error && <p role="alert">{message("site.front.logout_failed")}</p>}
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						aria-label={message("site.front.open_account", { name })}
					>
						{name.slice(0, 1).toUpperCase()}
					</Button>
				</PopoverTrigger>
				<PopoverContent
					align="end"
					className="native-front-account-menu"
					role="menu"
					aria-label={message("site.front.account_menu")}
					onKeyDown={(event) => {
						const items = [
							...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'),
						];
						const index = items.findIndex((item) => item === document.activeElement);
						let next: number | undefined;
						if (event.key === "ArrowDown") next = (index + 1) % items.length;
						if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
						if (event.key === "Home") next = 0;
						if (event.key === "End") next = items.length - 1;
						if (next !== undefined) {
							event.preventDefault();
							items[next]?.focus();
						}
					}}
				>
					<strong>{name}</strong>
					{activePluginIds.includes("supbrd-plug-user") && (
						<a role="menuitem" href="/account">
							{message("site.front.account")}
						</a>
					)}
					{activePluginIds.includes("supbrd-plug-settings") && (
						<a role="menuitem" href="/project-settings">
							{message("site.front.project_settings")}
						</a>
					)}
					<Button
						role="menuitem"
						variant="ghost"
						onClick={() => {
							setTheme(resolvedTheme === "dark" ? "light" : "dark");
							setOpen(false);
						}}
					>
						{message(resolvedTheme === "dark" ? "site.front.light_mode" : "site.front.dark_mode")}
					</Button>
					<Button role="menuitem" variant="ghost" disabled={busy} onClick={() => void logout()}>
						{message("site.front.logout")}
					</Button>
				</PopoverContent>
			</Popover>
		</div>
	);
}
