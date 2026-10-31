import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { History, Search, Zap } from "@superboard/front-ui/icons";
import { useTheme } from "@superboard/front-ui/theme";
import { Dialog, DialogContent, DialogTitle } from "@superboard/front-ui/ui/dialog.js";
import { useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";

import { frontCommandMessage, type FrontCommandMessageId } from "../lib/front-command-messages.js";
import {
	filterCommands,
	menuDestination,
	navigationCommands,
	recentCommands,
	type FrontCommand,
	type FrontCommandGroup,
} from "../lib/front-command-palette.js";
import { readFrontRecentPages } from "../lib/front-recent-pages.js";
import type { NativeFrontNavigationGroup } from "../lib/native-front-presentation.js";
import { frontLocaleSwitchHref, type UserFrontLocale } from "../lib/user-front-i18n.js";

const GROUP_LABELS = {
	recent: "group.recent",
	actions: "group.actions",
	pages: "group.pages",
} as const satisfies Record<FrontCommandGroup, FrontCommandMessageId>;
const GROUP_ICONS = { recent: History, actions: Zap, pages: Search };

interface PaletteProps {
	navigation: readonly NativeFrontNavigationGroup[];
	currentHref: string | undefined;
	recentKey: string;
	locale: UserFrontLocale;
	message(id: string, values?: Record<string, string>): string;
}

const MOVES: Record<string, (current: number, last: number) => number> = {
	ArrowDown: (current, last) => (current >= last ? 0 : current + 1),
	ArrowUp: (current, last) => (current <= 0 ? last : current - 1),
	PageDown: (current, last) => Math.min(current + 5, last),
	PageUp: (current) => Math.max(current - 5, 0),
};

/**
 * ⌘K / Ctrl+K palette of the Front shell: menu pages, quick actions and recent pages. Loaded on
 * first open so the shell bundle does not carry it.
 */
export default function NativeFrontCommandPalette({
	open,
	onOpenChange,
	...props
}: PaletteProps & { open: boolean; onOpenChange(open: boolean): void }) {
	const hintId = useId();
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="native-front-command-palette"
				showCloseButton={false}
				aria-describedby={hintId}
			>
				{/* Mounted only while open, so every opening starts from an empty search. */}
				<CommandPaletteBody
					{...props}
					hintId={hintId}
					close={() => {
						onOpenChange(false);
					}}
				/>
			</DialogContent>
		</Dialog>
	);
}

function CommandPaletteBody({
	navigation,
	currentHref,
	recentKey,
	locale,
	message,
	hintId,
	close,
}: PaletteProps & { hintId: string; close(): void }) {
	const { selectedProject, projectType, setProjectType, ready } = useProjectSelection();
	const { resolvedTheme, setTheme } = useTheme();
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const [recent] = useState(() => recentCommands(readFrontRecentPages(recentKey), currentHref));
	const id = useId();
	const t = useCallback(
		(key: FrontCommandMessageId, values?: Record<string, string>) =>
			frontCommandMessage(locale, key, values),
		[locale],
	);
	const listId = `${id}-list`;
	const optionId = (index: number) => `${id}-option-${index}`;

	const pages = useMemo(() => navigationCommands(navigation), [navigation]);
	const actions = useMemo(() => {
		const list: FrontCommand[] = [];
		const add = (command: Omit<FrontCommand, "group">) =>
			list.push({ ...command, group: "actions" });
		// Quick actions only exist when the EmDash menu offers their page to this operator.
		const createLink = menuDestination(pages, "/acquisition/dynamic-links", { create: "1" });
		if (createLink)
			add({
				id: "action:dynamic-link",
				label: t("create_dynamic_link"),
				keywords: "new link url shortlink deep",
				href: createLink,
			});
		const emails = menuDestination(pages, "/communication/marketing-email");
		if (emails)
			add({
				id: "action:email",
				label: t("create_email"),
				keywords: "new campaign newsletter mail",
				href: emails,
			});
		const team = menuDestination(pages, "/core/settings", { tab: "team" });
		if (team)
			add({
				id: "action:invite",
				label: t("invite_member"),
				keywords: "team member people collaborator",
				href: team,
			});
		const keys = pages.find((command) => command.href?.includes("section=keys"));
		if (keys?.href)
			add({
				id: "action:api-keys",
				label: t("api_keys"),
				hint: [keys.hint, keys.label].filter(Boolean).join(" › "),
				keywords: "token secret credentials",
				href: keys.href,
			});
		if (ready !== false && selectedProject) {
			const next = projectType === "test" ? "production" : "test";
			add({
				id: "action:project",
				label: t(next === "test" ? "switch_test" : "switch_production"),
				keywords: "environment project data sandbox live",
				run: () => {
					setProjectType(next);
				},
			});
		}
		add({
			id: "action:theme",
			label: t(resolvedTheme === "dark" ? "theme_light" : "theme_dark"),
			keywords: "theme appearance dark light",
			run: () => {
				setTheme(resolvedTheme === "dark" ? "light" : "dark");
			},
		});
		for (const value of ["en", "fr"] as const) {
			if (value === locale) continue;
			add({
				id: `action:language:${value}`,
				label: t("language", {
					language: message(`site.front.language.${value}`),
				}),
				keywords: "language langue locale english francais",
				run: () => {
					window.location.assign(frontLocaleSwitchHref(window.location.href, value));
				},
			});
		}
		return list;
	}, [
		pages,
		locale,
		message,
		t,
		ready,
		selectedProject,
		projectType,
		setProjectType,
		resolvedTheme,
		setTheme,
	]);

	const results = useMemo(
		() => filterCommands([...recent, ...actions, ...pages], query),
		[recent, actions, pages, query],
	);
	const current = Math.min(active, Math.max(results.length - 1, 0));

	useEffect(() => {
		document.getElementById(optionId(current))?.scrollIntoView?.({ block: "nearest" });
	});

	const execute = (command: FrontCommand | undefined) => {
		if (!command) return;
		close();
		if (command.run) command.run();
		else if (command.href && command.target === "_blank")
			window.open(command.href, "_blank", "noopener,noreferrer");
		else if (command.href) window.location.assign(command.href);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.nativeEvent.isComposing) return;
		const move = MOVES[event.key];
		if (move && results.length) {
			event.preventDefault();
			setActive(move(current, results.length - 1));
		} else if (event.key === "Enter") {
			event.preventDefault();
			execute(results[current]);
		}
	};

	const sections: Array<{ group: FrontCommandGroup; items: Array<[FrontCommand, number]> }> = [];
	results.forEach((command, index) => {
		const section = sections.at(-1);
		if (section?.group === command.group) section.items.push([command, index]);
		else sections.push({ group: command.group, items: [[command, index]] });
	});

	return (
		<>
			<DialogTitle className="native-front-visually-hidden">{t("title")}</DialogTitle>
			<div className="native-front-command-search">
				<Search aria-hidden="true" size={16} />
				<input
					type="text"
					role="combobox"
					aria-expanded="true"
					aria-controls={listId}
					aria-autocomplete="list"
					aria-activedescendant={results.length ? optionId(current) : undefined}
					aria-label={message("site.front.command.label")}
					placeholder={t("placeholder")}
					autoComplete="off"
					autoCapitalize="off"
					spellCheck={false}
					enterKeyHint="go"
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setActive(0);
					}}
					onKeyDown={onKeyDown}
				/>
				<kbd aria-hidden="true">Esc</kbd>
			</div>
			<div
				id={listId}
				role="listbox"
				aria-label={t("results")}
				className="native-front-command-list"
			>
				{sections.map(({ group, items }) => {
					const Icon = GROUP_ICONS[group];
					return (
						<div key={group} role="group" aria-labelledby={`${id}-${group}`}>
							<div id={`${id}-${group}`} className="native-front-command-heading">
								{t(GROUP_LABELS[group])}
							</div>
							{items.map(([command, index]) => (
								// Options stay out of the tab order: the search field owns focus and points at
								// the active option through aria-activedescendant.
								<div
									key={command.id}
									id={optionId(index)}
									role="option"
									tabIndex={-1}
									aria-selected={index === current}
									className="native-front-command-option"
									onMouseDown={(event) => {
										event.preventDefault();
									}}
									onMouseMove={() => {
										if (index !== current) setActive(index);
									}}
									onClick={() => {
										execute(command);
									}}
									onKeyDown={(event) => {
										if (event.key === "Enter") execute(command);
									}}
								>
									<Icon aria-hidden="true" size={15} />
									<span className="native-front-command-label">{command.label}</span>
									{command.hint ? (
										<span className="native-front-command-hint">{command.hint}</span>
									) : null}
								</div>
							))}
						</div>
					);
				})}
			</div>
			{results.length === 0 ? (
				<p role="status" className="native-front-command-empty">
					{t("empty", { query: query.trim() })}
				</p>
			) : null}
			<p id={hintId} className="native-front-command-footer">
				{t("hint")}
			</p>
		</>
	);
}
