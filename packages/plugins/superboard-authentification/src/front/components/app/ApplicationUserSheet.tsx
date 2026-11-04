import { usePluginEnabled } from "@superboard/front-ui/context";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import type { ReactNode } from "react";

import type {
	ApplicationUser,
	ApplicationUserDetail,
} from "../../api/identity/applicationUsersService.js";
import { useApplicationUsersI18n } from "../../application-users-i18n.js";

type Translate = ReturnType<typeof useApplicationUsersI18n>["t"];

export default function ApplicationUserSheet({
	detail,
	children,
}: {
	detail: ApplicationUserDetail;
	children: ReactNode;
}) {
	const { t, locale } = useApplicationUsersI18n();
	return (
		<article className="grid gap-6" aria-label={t("User sheet")}>
			<header>
				<h2 className="text-xl font-semibold">
					{detail.name || detail.email || t("Anonymous user")}
				</h2>
				<p className="break-all text-sm text-muted-foreground">{detail.email || detail.id}</p>
			</header>
			<dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
				<Fact label={t("Sign-in")}>{signInMethods(detail, t)}</Fact>
				<Fact label={t("Session")}>
					<SessionState user={detail} />
				</Fact>
				<Fact label={t("Signed up")}>{dateOnly(detail.created_at, locale)}</Fact>
				<Fact label={t("Last sign-in")}>
					{dateTime(detail.sessions.last_authenticated_at, locale)}
				</Fact>
			</dl>
			{children}
			<ElsewhereLinks detail={detail} />
		</article>
	);
}

export function SheetSection({
	title,
	icon,
	children,
}: {
	title: string;
	icon?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="grid gap-3 border-t pt-5">
			<h3 className="flex items-center gap-2 text-base font-semibold">
				{icon}
				{title}
			</h3>
			{children}
		</section>
	);
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div>
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="mt-1 text-sm font-medium">{children}</dd>
		</div>
	);
}

function ElsewhereLinks({ detail }: { detail: ApplicationUserDetail }) {
	const { t } = useApplicationUsersI18n();
	const marketing = usePluginEnabled("superboard-marketing");
	const support = usePluginEnabled("superboard-support");
	const analytics = usePluginEnabled("superboard-analytics");
	const contact = detail.email || detail.id;
	const links = [
		detail.email && marketing
			? {
					href: `/communication/marketing-email?tab=contacts&q=${encodeURIComponent(detail.email)}`,
					label: t("View in Communication › Audience"),
				}
			: null,
		support
			? { href: `/support/inbox?q=${encodeURIComponent(contact)}`, label: t("View in Support") }
			: null,
		analytics
			? {
					href: `/analytics/events?user=${encodeURIComponent(detail.id)}`,
					label: t("View events"),
				}
			: null,
		{ href: "/auth/users?tab=activity", label: t("Authentication emails and SMS") },
	].filter((link) => link !== null);
	return (
		<SheetSection title={t("Elsewhere in SuperBoard")}>
			<ul className="grid gap-2 text-sm">
				{links.map((link) => (
					<li key={link.href}>
						<a className="text-brand-link hover:underline" href={link.href}>
							{link.label}
						</a>
					</li>
				))}
			</ul>
		</SheetSection>
	);
}

export function signInMethods(user: ApplicationUser, t: Translate): string {
	const labels = user.auth_methods.map((method) =>
		method === "password"
			? t("Password")
			: method === "anonymous"
				? t("Anonymous")
				: method.charAt(0).toUpperCase() + method.slice(1),
	);
	if (labels.length === 0 && user.anonymous) labels.push(t("Anonymous"));
	return labels.join(", ") || "—";
}

export function SessionState({ user }: { user: ApplicationUser }) {
	const { t, locale } = useApplicationUsersI18n();
	if (user.active_session_count > 0)
		return (
			<Badge variant="secondary">
				{user.active_session_count === 1
					? t("Active")
					: t("{count} active", { count: user.active_session_count.toLocaleString(locale) })}
			</Badge>
		);
	return (
		<span className="text-muted-foreground">
			{user.last_session_at ? t("Inactive") : t("Never signed in")}
		</span>
	);
}

export function dateOnly(value: unknown, locale: string): string {
	if (typeof value !== "string" || !value) return locale === "fr" ? "Jamais" : "Never";
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(locale);
}

export function dateTime(value: unknown, locale: string): string {
	if (typeof value !== "string" || !value) return locale === "fr" ? "Jamais" : "Never";
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(locale);
}
