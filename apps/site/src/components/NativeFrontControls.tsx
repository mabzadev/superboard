import { useFrontContext } from "@superboard/front-ui/context";
import { useTheme } from "@superboard/front-ui/theme";
import { useState } from "react";

import { Button } from "../../../../packages/supbrd-front-ui/src/shared/components/ui/button.js";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "../../../../packages/supbrd-front-ui/src/shared/components/ui/popover.js";
import { useProjectSelection } from "../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js";

export function NativeFrontControls({
	message,
}: {
	message(id: string, values?: Record<string, string>): string;
}) {
	const { operator, activePluginIds, instanceId } = useFrontContext();
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
			<span className="native-front-instance-name">{selectedInstance?.name ?? instanceId}</span>
			{ready !== false && selectedProject && (
				<select
					aria-label={message("site.front.environment")}
					value={projectType}
					onChange={(event) => setProjectType(event.target.value)}
				>
					<option value="production">{message("site.front.production")}</option>
					<option value="test">{message("site.front.test")}</option>
				</select>
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
