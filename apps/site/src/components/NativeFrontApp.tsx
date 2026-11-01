import { canonicalFrontPath } from "@superboard/contracts/front-paths";
import { Search } from "@superboard/front-ui/icons";
import { watchPluginLifecycle } from "@superboard/front-ui/lifecycle";
import {
	SectionNavigation,
	SectionNavigationProvider,
} from "@superboard/front-ui/section-navigation";
import { Button } from "@superboard/front-ui/ui/button.js";
import type {
	NativeRendererBlock,
	NativeRendererCard,
	NativeRendererDocument,
} from "@superboard/supbrd-core";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type ComponentProps,
	type ComponentType,
	type CSSProperties,
} from "react";

import { frontRecentPagesKey, recordFrontRecentPage } from "../lib/front-recent-pages.js";
import type { NativeFrontPresentationProjection } from "../lib/native-front-presentation.js";
import { mountProjectedNativeFrontRenderer } from "../lib/native-front-renderers.js";
import { organizeProductNavigation } from "../lib/product-navigation.js";
import {
	createUserFrontI18n,
	localizeFrontPath,
	USER_FRONT_CATALOGS,
} from "../lib/user-front-i18n.js";
import { FrontRuntimeProviders } from "./FrontRuntimeProviders.js";
import type CommandPalette from "./NativeFrontCommandPalette.js";
import { NativeFrontControls } from "./NativeFrontControls.js";
import { NativeFrontNavigation } from "./NativeFrontNavigation.js";
import { PluginFrontView } from "./PluginFrontView.js";

const HREF_SUFFIX_PATTERN = /[?#]/u;
const APPLE_PLATFORM = /Mac|iPhone|iPad|iPod/u;
// The command palette is fetched on first use (or when its button is hovered or focused) so the
// shell bundle stays small. A failed fetch renders nothing instead of breaking the shell.
const loadCommandPalette = () => import("./NativeFrontCommandPalette.js");
const NativeFrontCommandPalette = lazy(
	(): Promise<{ default: ComponentType<ComponentProps<typeof CommandPalette>> }> =>
		loadCommandPalette().catch(() => ({ default: () => null })),
);
const prefetchCommandPalette = () => void loadCommandPalette().catch(() => undefined);
const subscribeToNothing = () => () => undefined;
const platformShortcut = () => (APPLE_PLATFORM.test(navigator.userAgent) ? "⌘K" : "Ctrl K");

export function NativeFrontApp({ projection }: { projection: NativeFrontPresentationProjection }) {
	return (
		<FrontRuntimeProviders
			key={projection.deployment?.id ?? projection.instance_id}
			projection={projection}
		>
			<NativeFrontShell projection={projection} />
		</FrontRuntimeProviders>
	);
}

function NativeFrontShell({ projection }: { projection: NativeFrontPresentationProjection }) {
	useEffect(watchPluginLifecycle, []);
	const [collapsed, setCollapsed] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [paletteRequested, setPaletteRequested] = useState(false);
	// The server render has no platform: the shortcut hint appears once hydrated.
	const paletteShortcut = useSyncExternalStore(
		subscribeToNothing,
		platformShortcut,
		() => undefined,
	);
	const navigationButton = useRef<HTMLButtonElement>(null);
	const sidebar = useRef<HTMLElement>(null);
	useEffect(() => {
		try {
			setCollapsed(
				localStorage.getItem(
					`superboard:${projection.instance_id}:${projection.operator?.id ?? "anonymous"}:sidebar`,
				) === "collapsed",
			);
		} catch {
			setCollapsed(false);
		}
	}, [projection.instance_id, projection.operator?.id]);
	useEffect(() => {
		if (!mobileOpen) return;
		const first = sidebar.current?.querySelector<HTMLElement>("a, button, summary");
		first?.focus();
		const close = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setMobileOpen(false);
				navigationButton.current?.focus();
			}
			if (event.key === "Tab" && sidebar.current) {
				const items = [
					...sidebar.current.querySelectorAll<HTMLElement>("a, button, summary"),
				].filter((item) => item.getClientRects().length > 0);
				const end = items.at(-1);
				const start = items[0];
				if (event.shiftKey && document.activeElement === start) {
					event.preventDefault();
					end?.focus();
				} else if (!event.shiftKey && document.activeElement === end) {
					event.preventDefault();
					start?.focus();
				}
			}
		};
		document.addEventListener("keydown", close);
		return () => document.removeEventListener("keydown", close);
	}, [mobileOpen]);
	const navigation = useMemo(
		() =>
			organizeProductNavigation(
				projection.navigation.map((group) => ({
					...group,
					items: localizeNavigationItems(group.items, projection.locale),
				})),
				// The query tells apart entries sharing a page, e.g. Environment settings › API keys.
				localizeFrontPath(
					`${projection.path}${globalThis.location?.search ?? ""}`,
					projection.locale,
				),
			),
		[projection.navigation, projection.locale, projection.path],
	);
	const messages = useMemo(
		() => ({
			...USER_FRONT_CATALOGS[projection.locale],
			...projection.messages,
			"site.front.title": USER_FRONT_CATALOGS[projection.locale]["site.front.title"],
		}),
		[projection.locale, projection.messages],
	);
	const i18n = useMemo(
		() => createUserFrontI18n(projection.locale, messages),
		[projection.locale, messages],
	);
	const message = useCallback(
		(id: string, values?: Record<string, string>) =>
			Object.hasOwn(messages, id) ? i18n._(id, values) : id,
		[messages, i18n],
	);
	const sectionNavigation = useMemo(
		() =>
			navigation.localItems.length > 1 ? (
				<nav className="native-front-local-navigation" aria-label={message("navigation.local")}>
					{navigation.localItems.map((item) => (
						<a
							key={item.route_id}
							href={item.href}
							aria-current={item.route_id === navigation.activeItem?.route_id ? "page" : undefined}
						>
							{item.label}
						</a>
					))}
				</nav>
			) : null,
		[navigation, message],
	);
	const { layouts, contents, state } = useMemo(() => {
		const mount = (input: NativeFrontPresentationProjection["content_mounts"][number]) =>
			mountProjectedNativeFrontRenderer({ mount: input, plugin_lock: projection.plugin_lock });
		return {
			layouts: projection.layout_mounts.map(mount),
			contents: projection.content_mounts.map(mount),
			state: projection.state_mount ? mount(projection.state_mount) : null,
		};
	}, [
		projection.plugin_lock,
		projection.layout_mounts,
		projection.content_mounts,
		projection.state_mount,
	]);
	const dashboardMount = projection.content_mounts[0];
	const currentSurface = contents.find((document) => document.kind === "surface");
	const style: CSSProperties & { "--front-primary": string } = {
		"--front-primary": projection.theme.accent,
	};
	const dashboardView =
		!state && dashboardMount && dashboardMount.renderer.plugin_id !== "supbrd-core" ? (
			<div className="native-front-dashboard-view">
				<PluginFrontView projection={projection} message={message} />
				{currentSurface?.blocks.length ? (
					<div className="native-front-dashboard-additions">
						{currentSurface.blocks.map((block, index) => (
							<RendererBlock key={`${block.kind}:${index}`} block={block} message={message} />
						))}
					</div>
				) : null}
			</div>
		) : null;
	const body = state ? (
		<RendererDocument document={state} message={message} />
	) : dashboardView ? (
		dashboardView
	) : (
		contents.map((document) => (
			<RendererDocument
				key={`${document.kind}:${document.title}`}
				document={document}
				message={message}
			/>
		))
	);
	const layout = layouts.find((document) => document.kind === "layout");
	const hasLayout = Boolean(layout);
	const recentKey = frontRecentPagesKey(projection.instance_id, projection.operator?.id);
	useEffect(() => {
		if (!hasLayout) return;
		const toggle = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey) return;
			if (!(event.metaKey || event.ctrlKey)) return;
			event.preventDefault();
			setPaletteRequested(true);
			setPaletteOpen((open) => !open);
		};
		document.addEventListener("keydown", toggle);
		return () => {
			document.removeEventListener("keydown", toggle);
		};
	}, [hasLayout]);
	const activeItem = navigation.activeItem;
	useEffect(() => {
		if (!hasLayout || !activeItem) return;
		const group = navigation.groups.find(({ items }) =>
			items.some(({ href }) => href === navigation.activeHref),
		);
		const root = group?.items.find(({ href }) => href === navigation.activeHref);
		const trail = [group?.label, root?.label].filter(
			(label, index, all): label is string =>
				Boolean(label) && label !== activeItem.label && all.indexOf(label) === index,
		);
		recordFrontRecentPage(recentKey, {
			href: activeItem.href,
			label: activeItem.label,
			...(trail.length ? { hint: trail.join(" › ") } : {}),
		});
	}, [hasLayout, activeItem, navigation.groups, navigation.activeHref, recentKey]);
	if (!layout) {
		return (
			<div className="native-front native-front-standalone" style={style}>
				{body}
			</div>
		);
	}
	// The brand and the menu's Overview entry lead to the same page: the canonical home
	// destination when the menu lists it, otherwise the always-available core home.
	const homeHref =
		navigation.groups
			.flatMap(({ items }) => items)
			.find((item) => item.href.split(HREF_SUFFIX_PATTERN, 1)[0] === canonicalFrontPath("/"))
			?.href ?? layout.home_href;
	return (
		<div
			className="native-front native-front-layout"
			style={style}
			data-collapsed={collapsed}
			data-mobile-open={mobileOpen}
		>
			{mobileOpen && (
				<button
					type="button"
					tabIndex={-1}
					aria-hidden="true"
					className="native-front-nav-backdrop"
					aria-label={message("site.front.close_navigation")}
					onClick={() => setMobileOpen(false)}
				/>
			)}
			<aside
				ref={sidebar}
				className="native-front-sidebar"
				data-slot="sidebar-container"
				role={mobileOpen ? "dialog" : undefined}
				aria-modal={mobileOpen || undefined}
				aria-label={message(layout.navigation_label)}
			>
				<div className="native-front-brand-wrap">
					<a className="native-front-brand" href={homeHref}>
						<span className="native-front-brand-mark" aria-hidden="true" />
						<span className="native-front-brand-name">{message(layout.title)}</span>
					</a>
					<Button
						className="native-front-collapse"
						variant="ghost"
						size="icon"
						aria-label={message(
							collapsed ? "site.front.expand_sidebar" : "site.front.collapse_sidebar",
						)}
						aria-expanded={!collapsed}
						onClick={() => {
							setCollapsed(!collapsed);
							try {
								localStorage.setItem(
									`superboard:${projection.instance_id}:${projection.operator?.id ?? "anonymous"}:sidebar`,
									!collapsed ? "collapsed" : "expanded",
								);
							} catch {
								return;
							}
						}}
					>
						{collapsed ? "›" : "‹"}
					</Button>
					<Button
						className="native-front-mobile-close"
						variant="ghost"
						size="icon"
						aria-label={message("site.front.close_navigation")}
						onClick={() => setMobileOpen(false)}
					>
						×
					</Button>
				</div>
				<nav aria-label={message(layout.navigation_label)}>
					<NativeFrontNavigation
						navigation={navigation}
						collapsed={collapsed}
						expand={() => {
							setCollapsed(false);
							try {
								localStorage.setItem(
									`superboard:${projection.instance_id}:${projection.operator?.id ?? "anonymous"}:sidebar`,
									"expanded",
								);
							} catch {
								return;
							}
						}}
						closeMobile={() => setMobileOpen(false)}
					/>
				</nav>
			</aside>
			<div className="native-front-content">
				<header>
					<Button
						ref={navigationButton}
						className="native-front-mobile-open"
						variant="ghost"
						size="icon"
						aria-label={message("site.front.open_navigation")}
						aria-expanded={mobileOpen}
						onClick={() => setMobileOpen(!mobileOpen)}
					>
						☰
					</Button>
					<div className="native-front-header-actions">
						<button
							type="button"
							className="native-front-command-trigger"
							aria-haspopup="dialog"
							aria-expanded={paletteOpen}
							aria-keyshortcuts="Meta+K Control+K"
							aria-label={message("site.front.command.label")}
							onPointerEnter={prefetchCommandPalette}
							onFocus={prefetchCommandPalette}
							onClick={() => {
								setPaletteRequested(true);
								setPaletteOpen(true);
							}}
						>
							<Search aria-hidden="true" size={15} />
							<span className="native-front-command-trigger-label">
								{message("site.front.command.open")}
							</span>
							{paletteShortcut ? <kbd aria-hidden="true">{paletteShortcut}</kbd> : null}
						</button>
						<NativeFrontControls
							message={message}
							locale={projection.locale}
							actions={layout.actions}
						/>
					</div>
				</header>
				<main className={dashboardView ? "native-front-dashboard-main" : undefined}>
					<SectionNavigationProvider value={sectionNavigation}>{body}</SectionNavigationProvider>
				</main>
			</div>
			{paletteRequested ? (
				<Suspense fallback={null}>
					<NativeFrontCommandPalette
						open={paletteOpen}
						onOpenChange={setPaletteOpen}
						navigation={navigation.groups}
						currentHref={activeItem?.href}
						recentKey={recentKey}
						locale={projection.locale}
						message={message}
					/>
				</Suspense>
			) : null}
		</div>
	);
}

function RendererDocument({
	document,
	message,
}: {
	document: NativeRendererDocument;
	message: (id: string) => string;
}) {
	if (document.kind === "layout") return null;
	if (document.kind === "state") {
		return (
			<section className="native-front-state-card">
				<h1>{message(document.title)}</h1>
				<p>{message(document.description)}</p>
			</section>
		);
	}
	return (
		<section className="native-front-page">
			<header className="native-front-page-header">
				<div>
					<p className="native-front-eyebrow">{message(document.eyebrow)}</p>
					<h1>{message(document.title)}</h1>
					{document.description ? <p>{message(document.description)}</p> : null}
				</div>
				<ActionList actions={document.actions} message={message} />
			</header>
			<SectionNavigation />
			<div className="native-front-blocks">
				{document.blocks.map((block, index) => (
					<RendererBlock key={`${block.kind}:${index}`} block={block} message={message} />
				))}
			</div>
		</section>
	);
}

function RendererBlock({
	block,
	message,
}: {
	block: NativeRendererBlock;
	message: (id: string) => string;
}) {
	if (block.kind === "notice") {
		return (
			<section className="native-front-notice">
				<span aria-hidden="true">✓</span>
				<div>
					<h2>{message(block.title)}</h2>
					<p>{message(block.description)}</p>
				</div>
			</section>
		);
	}
	if (block.kind === "columns") {
		return (
			<div className="native-front-columns">
				{block.columns.map((card) => (
					<NativeCard key={card.title} card={card} message={message} />
				))}
			</div>
		);
	}
	return <NativeCard card={block} message={message} />;
}

function NativeCard({
	card,
	message,
}: {
	card: NativeRendererCard;
	message: (id: string) => string;
}) {
	return (
		<section className="native-front-card">
			<header>
				<h2>{message(card.title)}</h2>
				{card.description ? <p>{message(card.description)}</p> : null}
			</header>
			<div className="native-front-card-content">
				{card.fields?.map((field) => (
					<label key={field.label} className="native-front-field">
						<span>{message(field.label)}</span>
						{field.control === "textarea" ? (
							<textarea
								defaultValue={field.value}
								placeholder={field.placeholder ? message(field.placeholder) : undefined}
							/>
						) : (
							<input
								type={field.control}
								defaultValue={field.value}
								placeholder={field.placeholder ? message(field.placeholder) : undefined}
								min={field.control === "range" ? 0 : undefined}
								max={field.control === "range" ? 100 : undefined}
							/>
						)}
					</label>
				))}
				{card.action_label ? (
					<button type="button" className="native-front-primary-action" disabled>
						{message(card.action_label)}
					</button>
				) : null}
				{card.empty_state ? (
					<div className="native-front-empty">{message(card.empty_state)}</div>
				) : null}
			</div>
		</section>
	);
}

function ActionList({
	actions,
	message,
}: {
	actions: readonly { label: string; href: string }[];
	message: (id: string) => string;
}) {
	if (actions.length === 0) return null;
	return (
		<div className="native-front-actions">
			{actions.map(({ label, href }) => (
				<a key={href} href={href}>
					{message(label)}
				</a>
			))}
		</div>
	);
}

function localizeNavigationItems(
	items: NativeFrontPresentationProjection["navigation"][number]["items"],
	locale: NativeFrontPresentationProjection["locale"],
): typeof items {
	return items.map((item) => ({
		...item,
		href: localizeFrontPath(item.href, locale),
		...(item.children ? { children: localizeNavigationItems(item.children, locale) } : {}),
	}));
}
