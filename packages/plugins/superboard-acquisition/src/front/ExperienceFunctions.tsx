import { useFlowI18n } from "./flows/features/flows/i18n.js";

const functions = [
	["workflows", "/acquisition/workflows"],
	["launchpad", "/acquisition/launchpad"],
	["components", "/acquisition/components"],
] as const;

/** Project-wide experience functions, linked once from the Paywalls and Onboardings lists. */
export function ExperienceFunctionLinks() {
	const { t, tr, locale } = useFlowI18n();
	const hint = tr("These functions are shared by the experiences in this project.");
	return (
		<nav aria-label={hint} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
			<span className="text-muted-foreground">{hint}</span>
			{functions.map(([key, href]) => (
				<a
					key={key}
					href={`${href}?lang=${locale}`}
					className="font-medium underline-offset-4 hover:underline"
				>
					{t(key)}
				</a>
			))}
		</nav>
	);
}
