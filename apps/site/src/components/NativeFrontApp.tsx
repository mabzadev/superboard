import { setupI18n } from "@lingui/core";
import type {
	NativeRendererBlock,
	NativeRendererCard,
	NativeRendererDocument,
} from "@superboard/supbrd-core";
import type { CSSProperties } from "react";

import { mountNativeFrontRenderer } from "../lib/native-front-plugins.js";
import type { NativeFrontPresentationProjection } from "../lib/native-front-presentation.js";

import "../styles/native-front.css";

export function NativeFrontApp({ projection }: { projection: NativeFrontPresentationProjection }) {
	const i18n = setupI18n({
		locale: projection.locale,
		messages: { [projection.locale]: projection.messages },
	});
	const message = (id: string) => i18n._(id);
	const mount = (input: NativeFrontPresentationProjection["content_mounts"][number]) =>
		mountNativeFrontRenderer({ mount: input, plugin_lock: projection.plugin_lock });
	const layouts = projection.layout_mounts.map(mount);
	const contents = projection.content_mounts.map(mount);
	const state = projection.state_mount ? mount(projection.state_mount) : null;
	const style = {
		"--front-primary": projection.theme.accent,
	} as CSSProperties;
	const body = state ? (
		<RendererDocument document={state} message={message} />
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
	const currentSurface = contents.find((document) => document.kind === "surface");
	if (!layout) {
		return (
			<div className="native-front native-front-standalone" style={style}>
				{body}
			</div>
		);
	}
	return (
		<div className="native-front native-front-layout" style={style}>
			<aside className="native-front-sidebar">
				<div className="native-front-brand-wrap">
					<a className="native-front-brand" href={layout.home_href}>
						<span className="native-front-brand-mark" aria-hidden="true" />
						{message(layout.title)}
					</a>
				</div>
				<nav aria-label={message(layout.navigation_label)}>
					{projection.navigation.map((group) => (
						<details
							key={group.group_id}
							open={group.items.some(({ href }) =>
								navigationItemActive(
									projection.path,
									href,
									group.items.map((item) => item.href),
								),
							)}
						>
							<summary>{message(group.label)}</summary>
							<div>
								{group.items.map((item) => (
									<a
										key={item.route_id}
										href={item.href}
										aria-current={
											navigationItemActive(
												projection.path,
												item.href,
												group.items.map((candidate) => candidate.href),
											)
												? "page"
												: undefined
										}
									>
										{message(item.label)}
									</a>
								))}
							</div>
						</details>
					))}
				</nav>
			</aside>
			<div className="native-front-content">
				<header>
					<div className="native-front-header-copy">
						<span>{message("site.front.title")}</span>
						<strong>{currentSurface ? message(currentSurface.title) : projection.path}</strong>
					</div>
					<ActionList actions={layout.actions} message={message} />
				</header>
				<main>{body}</main>
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

function activePath(path: string, href: string): boolean {
	return path === href || (href !== "/" && path.startsWith(`${href}/`));
}

function navigationItemActive(path: string, href: string, siblingHrefs: readonly string[]) {
	return siblingHrefs.includes(path) ? path === href : activePath(path, href);
}
