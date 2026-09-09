import { setupI18n } from "@lingui/core";
import { watchPluginLifecycle } from "@superboard/front-ui/lifecycle";
import type {
	NativeRendererBlock,
	NativeRendererCard,
	NativeRendererDocument,
} from "@superboard/supbrd-core";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { Button } from "../../../../packages/supbrd-front-ui/src/shared/components/ui/button.js";
import { mountNativeFrontRenderer } from "../lib/native-front-plugins.js";
import type { NativeFrontPresentationProjection } from "../lib/native-front-presentation.js";
import { organizeProductNavigation } from "../lib/product-navigation.js";
import { localizeFrontPath, USER_FRONT_CATALOGS } from "../lib/user-front-i18n.js";
import { FrontRuntimeProviders } from "./FrontRuntimeProviders.js";
import { NativeFrontControls } from "./NativeFrontControls.js";
import { NativeFrontNavigation } from "./NativeFrontNavigation.js";
import { PluginFrontView } from "./PluginFrontView.js";

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
	const navigation = organizeProductNavigation(
		projection.navigation.map((group) => ({
			...group,
			items: localizeNavigationItems(group.items, projection.locale),
		})),
		localizeFrontPath(projection.path, projection.locale),
	);
	const messages = {
		...USER_FRONT_CATALOGS[projection.locale],
		...projection.messages,
		"site.front.title": USER_FRONT_CATALOGS[projection.locale]["site.front.title"],
	};
	const i18n = setupI18n({
		locale: projection.locale,
		messages: { [projection.locale]: messages },
	});
	const message = (id: string, values?: Record<string, string>) =>
		Object.hasOwn(messages, id) ? i18n._(id, values) : id;
	const mount = (input: NativeFrontPresentationProjection["content_mounts"][number]) =>
		mountNativeFrontRenderer({ mount: input, plugin_lock: projection.plugin_lock });
	const layouts = projection.layout_mounts.map(mount);
	const contents = projection.content_mounts.map(mount);
	const dashboardMount = projection.content_mounts[0];
	const state = projection.state_mount ? mount(projection.state_mount) : null;
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
	if (!layout) {
		return (
			<div className="native-front native-front-standalone" style={style}>
				{body}
			</div>
		);
	}
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
					<a className="native-front-brand" href={layout.home_href}>
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
					<div className="native-front-header-copy">
						<span>{message("site.front.title")}</span>
						<strong>
							{navigation.activeItem
								? navigation.activeItem.label
								: currentSurface
									? message(currentSurface.title)
									: projection.path}
						</strong>
					</div>
					<div className="native-front-header-actions">
						<NativeFrontControls message={message} locale={projection.locale} />
						<ActionList actions={layout.actions} message={message} />
					</div>
				</header>
				<main className={dashboardView ? "native-front-dashboard-main" : undefined}>
					{navigation.localItems.length > 1 && (
						<nav className="native-front-local-navigation" aria-label={message("navigation.local")}>
							{navigation.localItems.map((item) => (
								<a
									key={item.route_id}
									href={item.href}
									aria-current={
										item.route_id === navigation.activeItem?.route_id ? "page" : undefined
									}
								>
									{item.label}
								</a>
							))}
						</nav>
					)}
					{body}
				</main>
			</div>
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
