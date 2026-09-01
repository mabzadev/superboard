import { setupI18n } from "@lingui/core";
import type { NativeRendererDocument } from "@superboard/supbrd-core";
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
		"--front-accent": projection.theme.accent,
		"--front-background": projection.theme.background,
		"--front-foreground": projection.theme.foreground,
		"--front-panel": projection.theme.panel,
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
				<a className="native-front-brand" href={layout.home_href}>
					{message(layout.title)}
				</a>
				<p>{message(layout.description)}</p>
				<nav aria-label={message(layout.navigation_label)}>
					{projection.navigation.map((group) => (
						<details
							key={group.group_id}
							open={group.items.some(({ href }) => activePath(projection.path, href))}
						>
							<summary>{message(group.label)}</summary>
							<div>
								{group.items.map((item) => (
									<a
										key={item.route_id}
										href={item.href}
										aria-current={activePath(projection.path, item.href) ? "page" : undefined}
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
					<span>{projection.path}</span>
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
	return (
		<section className={`native-front-panel native-front-${document.kind}`}>
			{document.kind === "surface" ? (
				<p className="native-front-eyebrow">{message(document.eyebrow)}</p>
			) : null}
			<h1>{message(document.title)}</h1>
			<p>{message(document.description)}</p>
			{document.kind === "surface" ? (
				<>
					<dl>
						{document.details.map(({ label, value }) => (
							<div key={`${label}:${value}`}>
								<dt>{message(label)}</dt>
								<dd>{value}</dd>
							</div>
						))}
					</dl>
					<ActionList actions={document.actions} message={message} />
				</>
			) : null}
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
