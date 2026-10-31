import { useFrontContext } from "@superboard/front-ui/context";
import { useRouter } from "@superboard/front-ui/navigation";
import { PluginDiagnosticsLink } from "@superboard/front-ui/plugin-diagnostics-link";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import { useEffect } from "react";

const messages = {
	en: {
		title: "Data Settings",
		description: "Find the content and file settings of the Data module.",
		moved: "Content and file settings are available directly in their pages:",
		content: "Content settings",
		files: "File settings",
		opening: "Opening settings…",
	},
	fr: {
		title: "Paramètres Data",
		description: "Retrouvez les paramètres des contenus et des fichiers du module Data.",
		moved:
			"Les paramètres des contenus et des fichiers sont disponibles directement dans leurs pages :",
		content: "Paramètres des contenus",
		files: "Paramètres des fichiers",
		opening: "Ouverture des paramètres…",
	},
};

/**
 * Content and file settings live in their own pages; legacy `?tab=content|files` links open them there.
 * Service health and lifecycle are owned by the Plugins page, so `?tab=configuration` just lands here.
 */
const legacyTargets = { content: "/data/content", files: "/data/files" } as const;
function legacyTarget() {
	if (typeof window === "undefined") return null;
	const requested = new URLSearchParams(window.location.search).get("tab");
	return requested === "content" || requested === "files" ? legacyTargets[requested] : null;
}

export default function DataSettingsPage() {
	const { locale } = useFrontContext();
	const router = useRouter();
	const t = messages[locale === "fr" ? "fr" : "en"];
	const target = legacyTarget();
	useEffect(() => {
		if (target) router.replace(`${target}?tab=settings&lang=${locale}`);
	}, [target, router, locale]);
	return (
		<section className="ds-page space-y-5">
			<header className="ds-page-header">
				<div>
					<h1 className="ds-page-title">{t.title}</h1>
					<p className="ds-page-description">{t.description}</p>
				</div>
			</header>
			<SectionNavigation />
			{target ? (
				<p role="status">{t.opening}</p>
			) : (
				<>
					<p className="text-sm text-muted-foreground">
						{t.moved}{" "}
						<a className="underline" href={`/data/content?tab=settings&lang=${locale}`}>
							{t.content}
						</a>
						{" · "}
						<a className="underline" href={`/data/files?tab=settings&lang=${locale}`}>
							{t.files}
						</a>
					</p>
					<PluginDiagnosticsLink locale={locale} />
				</>
			)}
		</section>
	);
}
