import { usePluginEnabled } from "@superboard/front-ui/context";
import { LinkButton } from "@superboard/front-ui/kumo";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@superboard/front-ui/ui/card.js";
import { ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { ApplicationUserDetail } from "../../api/identity/applicationUsersService.js";
import { useApplicationUsersI18n } from "../../application-users-i18n.js";

const sections = ["account", "purchases", "messages", "support", "events"] as const;
type Section = (typeof sections)[number];
const labels: Record<Section, string> = {
	account: "Account",
	purchases: "Purchases & entitlements",
	messages: "Messages",
	support: "Support",
	events: "Events",
};

/**
 * One person, every dimension. Data owned by other plugins is reached through
 * their own views (deep links), never by importing their code.
 */
export default function ApplicationUserSheet({
	detail,
	account,
	purchases,
}: {
	detail: ApplicationUserDetail;
	account: ReactNode;
	purchases: ReactNode;
}) {
	const { t } = useApplicationUsersI18n();
	const [section, setSection] = useState<Section>("account");
	const marketing = usePluginEnabled("superboard-marketing");
	const support = usePluginEnabled("superboard-support");
	const analytics = usePluginEnabled("superboard-analytics");
	const contact = detail.email || detail.id;
	return (
		<section className="grid content-start gap-4" aria-label={t("User sheet")}>
			<header>
				<h2 className="text-lg font-semibold">
					{detail.name || detail.email || t("Anonymous user")}
				</h2>
				<p className="break-all font-mono text-xs text-muted-foreground">{detail.id}</p>
			</header>
			<div role="tablist" aria-label={t("User sheet")} className="flex flex-wrap gap-1">
				{sections.map((item) => (
					<Button
						key={item}
						role="tab"
						size="sm"
						variant={section === item ? "secondary" : "ghost"}
						aria-selected={section === item}
						onClick={() => {
							setSection(item);
						}}
					>
						{t(labels[item])}
					</Button>
				))}
			</div>
			{section === "account" && account}
			{section === "purchases" && purchases}
			{section === "messages" && (
				<DeepLink
					title={t("Messages")}
					description={
						detail.email
							? t("Email and marketing consent, lists and recent deliveries for {email}.", {
									email: detail.email,
								})
							: t("This account has no email address, so it cannot receive email.")
					}
					href={
						detail.email && marketing
							? `/communication/marketing-email?tab=contacts&q=${encodeURIComponent(detail.email)}`
							: null
					}
					label={t("View in Communication › Audience")}
					unavailable={detail.email ? t("Communication is not enabled.") : null}
				>
					<LinkButton href="/auth/users?tab=activity" size="sm" variant="ghost">
						{t("Authentication emails and SMS")}
					</LinkButton>
				</DeepLink>
			)}
			{section === "support" && (
				<DeepLink
					title={t("Support")}
					description={t("Conversations with {contact}.", { contact })}
					href={support ? `/support/inbox?q=${encodeURIComponent(contact)}` : null}
					label={t("View in Support")}
					unavailable={t("Support is not enabled.")}
				/>
			)}
			{section === "events" && (
				<DeepLink
					title={t("Events")}
					description={t("Recent analytics events sent by the SDK for this user.")}
					href={analytics ? `/analytics/events?user=${encodeURIComponent(detail.id)}` : null}
					label={t("View events")}
					unavailable={t("Analytics is not enabled.")}
				/>
			)}
		</section>
	);
}

function DeepLink({
	title,
	description,
	href,
	label,
	unavailable,
	children,
}: {
	title: string;
	description: string;
	href: string | null;
	label: string;
	unavailable: string | null;
	children?: ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-wrap items-center gap-2">
				{href ? (
					<LinkButton href={href} size="sm" variant="primary">
						<ExternalLink className="size-4" />
						{label}
					</LinkButton>
				) : (
					unavailable && <p className="text-sm text-muted-foreground">{unavailable}</p>
				)}
				{children}
			</CardContent>
		</Card>
	);
}
