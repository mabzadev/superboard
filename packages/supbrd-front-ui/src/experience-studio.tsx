import { canonicalEmailLocale } from "@superboard/contracts/email-studio";
import {
	experienceTranslations,
	validateExperienceEditor,
	localizeExperienceDefinition,
} from "@superboard/contracts/experience-localization";
import { useEffect, useMemo, useRef, useState } from "react";

import { useFrontContext } from "./context.js";
import { ExperienceFlowCanvas } from "./experience-flow-canvas.js";
import { createFrontI18n } from "./i18n.js";
import { Button, Checkbox, Input, InputArea, Select } from "./kumo.js";
import { useProjectSelection } from "./shared/context/useProjectSelection.js";
import { createPluginApiClient } from "./shared/lib/api.js";
import { config } from "./shared/lib/config.js";

type Block = {
	id: string;
	type:
		| "question"
		| "marketing_consent"
		| "heading"
		| "text"
		| "image"
		| "benefits"
		| "product"
		| "button"
		| "close"
		| "legal"
		| "spacer";
	props: Record<string, unknown>;
};
type Screen = {
	id: string;
	name: string;
	blocks: Block[];
	next_screen_id?: string | null;
	conditions?: Record<string, unknown>;
};
type Document = {
	schema_version: 1;
	theme: {
		accent_color: string;
		background_color: string;
		text_color: string;
		font_family: string;
		corner_radius: number;
	};
	screens: Screen[];
	metadata: Record<string, unknown>;
};
type Props = {
	kind: "paywall" | "onboarding";
	initialDocument: Document;
	onChange?: (document: Document, valid: boolean) => void;
	previewOnly?: boolean;
};
export function createStudioDocument(
	kind: "paywall" | "onboarding",
	locale: "en" | "fr",
): Document {
	const fr = locale === "fr";
	return {
		schema_version: 1,
		theme: {
			accent_color: "#6366f1",
			background_color: "#ffffff",
			text_color: "#111827",
			font_family: "Inter",
			corner_radius: 14,
		},
		metadata: {
			...(kind === "onboarding" ? { resume_progress: true } : {}),
			localization: { source_locale: locale, fallback_locale: locale, locales: {} },
		},
		screens: [
			{
				id: id(),
				name: kind === "paywall" ? "Paywall" : fr ? "Bienvenue" : "Welcome",
				blocks: [
					{
						id: id(),
						type: "heading",
						props: {
							text:
								kind === "paywall"
									? fr
										? "Profitez de toute l’expérience"
										: "Make the most of your experience"
									: fr
										? "Bienvenue, faisons connaissance"
										: "Welcome, let’s get to know you",
							align: "center",
						},
					},
					{
						id: id(),
						type: "text",
						props: {
							text:
								kind === "paywall"
									? fr
										? "Choisissez la formule qui vous convient."
										: "Choose the plan that fits you."
									: fr
										? "Quelques questions pour adapter votre parcours à vos objectifs."
										: "A few questions to tailor your experience to your goals.",
							align: "center",
						},
					},
					...(kind === "paywall"
						? [
								{
									id: id(),
									type: "product" as const,
									props: {
										style: "cards",
										offering_identifier: "default",
										package_identifiers: [],
									},
								},
							]
						: []),
					{
						id: id(),
						type: "button",
						props: {
							text:
								kind === "paywall"
									? fr
										? "Choisir ma formule"
										: "Choose my plan"
									: fr
										? "Commencer"
										: "Get started",
							action: kind === "paywall" ? "purchase" : "next",
						},
					},
					...(kind === "paywall"
						? [
								{
									id: id(),
									type: "button" as const,
									props: {
										text: fr ? "Restaurer mes achats" : "Restore purchases",
										action: "restore",
									},
								},
								{
									id: id(),
									type: "legal" as const,
									props: { text: fr ? "Conditions et confidentialité" : "Terms and privacy" },
								},
							]
						: []),
				],
			},
		],
	};
}
const french: Record<string, string> = {
	Details: "Informations",
	Locale: "Langue",
	"Minimum app version": "Version minimale de l’application",
	"A/B experience created as draft": "Test A/B créé en brouillon",
	Active: "Actif",
	"Add audience rule": "Ajouter une règle d’audience",
	Archive: "Archiver",
	"Choose exactly where a published version resolves in the SDK.":
		"Choisissez les emplacements qui affichent cette version publiée.",
	Complete: "Terminer",
	"Completion and drop-off across published onboarding flows.":
		"Progression et abandon dans les parcours d’accueil publiés.",
	"Conversion, revenue and event performance for the last 30 days.":
		"Conversions, revenus et événements des 30 derniers jours.",
	Count: "Nombre",
	Countries: "Pays",
	"Create 50/50 test": "Créer un test à parts égales",
	"Create a flow with its first visual draft.":
		"Créez un parcours et son premier brouillon visuel.",
	"Create a paywall, then save immutable versions.":
		"Créez un paywall, puis enregistrez ses versions.",
	"Create onboarding": "Créer un parcours d’accueil",
	"Create paywall": "Créer un paywall",
	"Delivery, targeting and A/B": "Diffusion, ciblage et tests A/B",
	Description: "Description",
	"Design multi-screen flows, target audiences and publish experiments.":
		"Créez les écrans de vos parcours, choisissez leurs audiences et publiez vos tests.",
	"Design, target, test and publish purchase experiences.":
		"Créez, ciblez et publiez vos écrans d’abonnement.",
	"Detailed events for the active statistical dimensions.":
		"Détail des événements pour les filtres sélectionnés.",
	"Display name": "Nom affiché",
	"Drag blocks, configure the theme and verify the mobile preview.":
		"Composez les blocs, ajustez le style et vérifiez le rendu mobile.",
	Event: "Événement",
	"Event timeline": "Historique des événements",
	"Experiment archived": "Test archivé",
	"Experiment name": "Nom du test",
	Identifier: "Identifiant",
	Library: "Bibliothèque",
	"Locale (optional)": "Langue (facultative)",
	Locales: "Langues",
	Name: "Nom",
	"No events match this period.": "Aucun événement sur cette période.",
	"No onboardings yet.": "Aucun parcours d’accueil pour le moment.",
	"No paywalls yet.": "Aucun paywall pour le moment.",
	"No step events match this period.": "Aucune étape enregistrée sur cette période.",
	"Onboarding and first draft created": "Parcours et premier brouillon créés",
	"Onboarding deleted": "Parcours supprimé",
	"Onboarding details updated": "Informations du parcours actualisées",
	"Onboarding statistics": "Résultats des parcours d’accueil",
	"Onboarding version published": "Version du parcours publiée",
	Onboardings: "Parcours d’accueil",
	"Paywall archived": "Paywall archivé",
	"Paywall created": "Paywall créé",
	"Paywall details updated": "Informations du paywall actualisées",
	"Paywall statistics": "Résultats des paywalls",
	"Paywall version archived": "Version du paywall archivée",
	"Paywall version published": "Version du paywall publiée",
	Period: "Période",
	Placement: "Emplacement",
	"Placement deactivated": "Emplacement désactivé",
	"Placement deleted": "Emplacement supprimé",
	"Placement key": "Clé de l’emplacement",
	Platform: "Plateforme",
	Platforms: "Plateformes",
	Priority: "Priorité",
	Publish: "Publier",
	"Publish two versions to create an A/B experiment.":
		"Publiez deux versions pour créer un test A/B.",
	"Published version": "Version publiée",
	"Reorder screens and blocks, configure transitions, theme and mobile preview.":
		"Organisez les écrans et les blocs, puis vérifiez les transitions et le rendu mobile.",
	"Resolve one published flow using placement priority, audience rules and stable variants.":
		"Diffusez un parcours publié selon les priorités, les règles d’audience et les variantes attribuées.",
	Revenue: "Revenu",
	"Save details": "Enregistrer les informations",
	"Save immutable draft": "Enregistrer une version",
	"Save placement": "Enregistrer l’emplacement",
	"Save the first draft to start version history.":
		"Enregistrez un premier brouillon pour démarrer l’historique.",
	"Select a placement…": "Choisissez un emplacement…",
	"Select…": "Choisissez…",
	Step: "Étape",
	"Step funnel": "Progression par étape",
	"Targeting rule created": "Règle de ciblage créée",
	"Targeting rule deleted": "Règle de ciblage supprimée",
	"Time series": "Évolution dans le temps",
	"Use onboarding active version": "Utiliser la version active du parcours",
	Version: "Version",
	"Version history": "Historique des versions",
	"Version notes": "Notes de version",
	"What changed?": "Qu’avez-vous modifié ?",
	"completion rate": "taux de complétion",
	"conversion rate": "taux de conversion",
	"drop-off rate": "taux d’abandon",
	priority: "priorité",
	"tracked revenue": "revenu mesuré",
	variants: "variantes",
	"· priority": "· priorité",
	Delivery: "Diffusion",
	Versions: "Versions",
	Results: "Résultats",

	Design: "Création",
	Journey: "Parcours",
	Preview: "Simulation",
	Languages: "Langues",
	Layers: "Structure",
	Blocks: "Blocs",
	heading: "Titre",
	text: "Texte",
	image: "Image",
	benefits: "Avantages",
	product: "Offre",
	button: "Bouton",
	close: "Fermer",
	legal: "Mentions",
	spacer: "Espacement",
	Undo: "Annuler",
	Redo: "Rétablir",
	Theme: "Style",
	Text: "Texte",
	Image: "Image",
	"Image URL": "Adresse de l’image",
	"Alternative text": "Texte alternatif",
	"Font size": "Taille du texte",
	Spacing: "Espacement",
	Alignment: "Alignement",
	left: "Gauche",
	center: "Centre",
	right: "Droite",
	Action: "Action",
	next: "Étape suivante",
	purchase: "Acheter",
	restore: "Restaurer",
	url: "Ouvrir un lien",
	"Offering identifier": "Identifiant de l’offre",
	"Package identifiers": "Identifiants des formules",
	"Store price": "Prix fourni par la boutique",
	"No offer configured": "Offre à configurer",
	"Select a block": "Sélectionnez un bloc",
	Duplicate: "Dupliquer",
	Delete: "Supprimer",
	"Add screen": "Ajouter un écran",
	"Screen name": "Nom de l’écran",
	"Next screen": "Écran suivant",
	Finish: "Terminer",
	Restart: "Recommencer",
	"Flow completed": "Parcours terminé",
	"Purchase preview": "Simulation d’achat",
	Templates: "Modèles",
	Minimal: "Épuré",
	Comparison: "Comparaison",
	Editorial: "Éditorial",
	Welcome: "Bienvenue",
	"Discover your next step": "Découvrez votre prochaine étape",
	"Make it yours": "Une expérience qui vous ressemble",
	Continue: "Continuer",
	Subscribe: "S’abonner",
	"Restore purchases": "Restaurer les achats",
	"Terms and privacy": "Conditions et confidentialité",
	"Accent color": "Couleur principale",
	Background: "Arrière-plan",
	"Text color": "Couleur du texte",
	Font: "Police",
	Radius: "Arrondi",
	Device: "Appareil",
	Phone: "Téléphone",
	Tablet: "Tablette",
	"Language code": "Code de langue",
	"Add language": "Ajouter une langue",
	"Source language": "Langue source",
	"Fallback language": "Langue de repli",
	"Edit source content": "Modifier le contenu source",
	"Translation content": "Contenu traduit",
	"Move up": "Monter",
	"Move down": "Descendre",
	"Profile attribute": "Attribut du profil",
	"Expected value": "Valeur attendue",
	"Display condition": "Condition d’affichage",
	"Any profile": "Tous les profils",
	"Create to save": "Créez cet élément pour l’enregistrer",
	"Resume progress": "Reprendre la progression",
	Saved: "Enregistré",
	Saving: "Enregistrement…",
	"Unsaved changes": "Modifications en attente",
	"Save failed": "Échec de l’enregistrement",
	Compare: "Comparer",
	"Compare versions": "Comparer les versions",
	Edit: "Modifier",
	"Visual paywall editor": "Éditeur de paywall",
	"Visual onboarding editor": "Éditeur de parcours",
	draft: "Brouillon",
	published: "Publié",
	archived: "Archivé",
	"Catalog unavailable": "Catalogue indisponible",
	"No price for this store": "Aucun prix pour cette boutique",
	Trial: "Essai",
	question: "Question",
	marketing_consent: "Préférences email",
	"Your goal": "Votre objectif",
	Beginner: "Débutant",
	Advanced: "Avancé",
	"Receive product news": "Recevoir les actualités du produit",
	"Restore preview": "Simulation de restauration",
	"Automatic next": "Étape suivante automatique",
	"Required answer": "Réponse obligatoire",
	"Answer attribute": "Attribut de réponse",
	"Option label": "Libellé du choix",
	"Add option": "Ajouter un choix",
	"After this answer": "Après ce choix",
	Height: "Hauteur",
	"Aspect ratio": "Proportions",
	"Accessibility label": "Libellé accessible",
	"Screen settings": "Réglages de l’écran",
	Lists: "Listes",
	"App version": "Version de l’application",
	platform: "Plateforme",
	locale: "Langue",
	min_app_version: "Version minimale",
	dismiss: "Fermer",
	complete: "Terminer",
};
const types: Block["type"][] = [
	"question",
	"marketing_consent",
	"heading",
	"text",
	"image",
	"benefits",
	"product",
	"button",
	"legal",
	"spacer",
	"close",
];
const id = () => crypto.randomUUID();
const catalogApi = createPluginApiClient("supbrd-plug-products");
type PreviewPrice = {
	package_identifier: string;
	display_name: string;
	price_micros: number | null;
	currency: string | null;
	billing_period: string | null;
	trial_period: string | null;
	store: string;
	synced_at: string | null;
};

export function useExperienceI18n() {
	const { locale } = useFrontContext();
	const t = useMemo(() => {
		const messages =
			locale === "fr"
				? french
				: {
						...Object.fromEntries(Object.keys(french).map((key) => [key, key])),
						heading: "Heading",
						text: "Text",
						image: "Image",
						product: "Product",
						button: "Button",
						legal: "Legal",
						spacer: "Spacer",
						close: "Close",
						question: "Question",
						marketing_consent: "Email preferences",
						benefits: "Benefits",
					};
		const i18n = createFrontI18n({ locale, messages: { [locale]: messages } });
		return (key: string) => (Object.hasOwn(messages, key) ? i18n._(key) : key);
	}, [locale]);
	return { locale, t };
}

export function ExperienceStudio({ kind, initialDocument, onChange, previewOnly = false }: Props) {
	const { t } = useExperienceI18n();
	const { selectedProject, projectType } = useProjectSelection();
	const [prices, setPrices] = useState<Record<string, PreviewPrice[]>>({});
	const [catalogError, setCatalogError] = useState("");
	const [history, setHistory] = useState({
		past: [] as Document[],
		value: initialDocument,
		future: [] as Document[],
	});
	const [screenId, setScreenId] = useState(initialDocument.screens[0]?.id ?? "");
	const [blockId, setBlockId] = useState("");
	const [mode, setMode] = useState(previewOnly ? "Preview" : "Design");
	const [language, setLanguage] = useState(
		experienceTranslations(initialDocument.metadata).source_locale,
	);
	const [languageInput, setLanguageInput] = useState("");
	const [device, setDevice] = useState("Phone");
	const [outcome, setOutcome] = useState("");
	const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
	const [profile, setProfile] = useState({
		field: "",
		value: "",
		platform: "ios",
		app_version: "1.0.0",
	});
	const notify = useRef(onChange);
	notify.current = onChange;
	const document = history.value;
	const issues = useMemo(() => validateExperienceEditor(document), [document]);
	const offeringKeys = [
		...new Set(
			document.screens.flatMap((screen) =>
				screen.blocks
					.filter((block) => block.type === "product")
					.map((block) => String(block.props.offering_identifier ?? "default")),
			),
		),
	]
		.sort()
		.join(",");
	useEffect(() => {
		if (kind !== "paywall" || !selectedProject || !offeringKeys) return;
		let active = true;
		setPrices({});
		setCatalogError("");
		const store =
			profile.platform === "android" ? "google" : profile.platform === "web" ? "stripe" : "apple";
		void Promise.all(
			offeringKeys.split(",").map(async (offering) => {
				const response = await catalogApi.GET(
					config.apiPath +
						"/products/projects/" +
						encodeURIComponent(selectedProject.id) +
						"/catalog/preview?" +
						new URLSearchParams({
							offering,
							store,
							environment: projectType === "test" ? "sandbox" : "production",
						}),
				);
				return [offering, response.data.data.items as PreviewPrice[]] as const;
			}),
		).then(
			(values) => {
				if (active) setPrices(Object.fromEntries(values));
			},
			() => {
				if (active) setCatalogError(t("Catalog unavailable"));
			},
		);
		return () => {
			active = false;
		};
	}, [kind, selectedProject, projectType, offeringKeys, profile.platform, t]);
	const translation = experienceTranslations(document.metadata);
	const contentText = (key: string) =>
		translation.source_locale.startsWith("fr") ? (french[key] ?? key) : key;
	const screen = document.screens.find((item) => item.id === screenId) ?? document.screens[0];
	const selected = screen?.blocks.find((item) => item.id === blockId);
	const previewDocument = useMemo(
		() =>
			localizeExperienceDefinition(
				document as unknown as Record<string, unknown>,
				language,
			) as unknown as Document,
		[document, language],
	);
	const previewScreen = previewDocument.screens.find((item) => item.id === screen?.id);
	useEffect(() => {
		notify.current?.(document, issues.length === 0);
	}, [document, issues.length]);
	const update = (transform: (value: Document) => Document) =>
		setHistory((value) => ({
			past: [...value.past.slice(-49), value.value],
			value: transform(structuredClone(value.value)),
			future: [],
		}));
	const updateScreen = (transform: (value: Screen) => Screen) =>
		update((value) => ({
			...value,
			screens: value.screens.map((item) => (item.id === screen?.id ? transform(item) : item)),
		}));
	const patch = (target: Block, props: Record<string, unknown>) => {
		const translationKey = kind === "onboarding" ? String(screen?.id) + "/" + target.id : target.id;
		if (language !== translation.source_locale)
			update((value) => {
				const translations = experienceTranslations(value.metadata);
				translations.locales[language] = {
					...translations.locales[language],
					[translationKey]: { ...translations.locales[language]?.[translationKey], ...props },
				};
				value.metadata.localization = translations;
				return value;
			});
		else
			updateScreen((value) => ({
				...value,
				blocks: value.blocks.map((item) =>
					item.id === target.id ? { ...item, props: { ...item.props, ...props } } : item,
				),
			}));
	};
	const add = (type: Block["type"]) => {
		const block: Block = {
			id: id(),
			type,
			props:
				type === "question"
					? {
							text: contentText("Your goal"),
							attribute: "goal",
							required: false,
							options: [
								{ value: "beginner", label: contentText("Beginner") },
								{ value: "advanced", label: contentText("Advanced") },
							],
						}
					: type === "marketing_consent"
						? {
								title: contentText("Receive product news"),
								default: false,
								required: false,
								list_ids: [],
							}
						: type === "product"
							? { offering_identifier: "default", package_identifiers: [] }
							: type === "spacer"
								? { height: 24 }
								: type === "image"
									? { url: "", alt: "" }
									: type === "benefits"
										? { items: [contentText("Make it yours")] }
										: {
												text: contentText(type === "button" ? "Continue" : type),
												...(type === "button"
													? { action: kind === "paywall" ? "purchase" : "next" }
													: {}),
											},
		};
		updateScreen((value) => ({ ...value, blocks: [...value.blocks, block] }));
		setBlockId(block.id);
	};
	const move = (target: string, delta: number) =>
		updateScreen((value) => {
			const blocks = [...value.blocks];
			const from = blocks.findIndex((item) => item.id === target);
			const to = from + delta;
			if (from < 0 || to < 0 || to >= blocks.length) return value;
			[blocks[from], blocks[to]] = [blocks[to]!, blocks[from]!];
			return { ...value, blocks };
		});
	const moveScreen = (delta: number) =>
		update((value) => {
			const index = value.screens.findIndex((item) => item.id === screen?.id);
			const target = index + delta;
			if (index < 0 || target < 0 || target >= value.screens.length) return value;
			[value.screens[index], value.screens[target]] = [
				value.screens[target]!,
				value.screens[index]!,
			];
			return value;
		});
	const matchesScreen = (item: Screen) => {
		const conditions = item.conditions ?? {};
		if (conditions.platform && conditions.platform !== profile.platform) return false;
		if (conditions.locale && conditions.locale !== language) return false;
		if (typeof conditions.min_app_version === "string") {
			const expected = conditions.min_app_version.split(".").map(Number),
				actual = profile.app_version.split(".").map(Number);
			for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
				if ((actual[i] ?? 0) > (expected[i] ?? 0)) break;
				if ((actual[i] ?? 0) < (expected[i] ?? 0)) return false;
			}
		}
		return true;
	};
	const action = (block: Block) => {
		if (mode !== "Preview") {
			setBlockId(block.id);
			return;
		}
		const required = screen?.blocks.find(
			(item) =>
				item.type === "question" && item.props.required && !answers[String(item.props.attribute)],
		);
		if (
			required &&
			["next", "complete", "purchase"].includes(String(block.props.action ?? "next"))
		) {
			setBlockId(required.id);
			return;
		}
		if (block.props.action === "purchase") {
			setOutcome(t("Purchase preview"));
			return;
		}
		if (block.type === "close" || ["dismiss", "complete"].includes(String(block.props.action))) {
			setOutcome(t("Flow completed"));
			return;
		}
		if (block.props.action === "restore") {
			setOutcome(t("Restore preview"));
			return;
		}
		const branch = screen?.blocks
			.filter((item) => item.type === "question")
			.flatMap((item) => {
				const options = Array.isArray(item.props.options)
					? (item.props.options as Array<Record<string, unknown>>)
					: [];
				const answer = answers[String(item.props.attribute)];
				const option = options.find((value) => value.value === answer);
				return typeof option?.next_screen_id === "string" ? [option.next_screen_id] : [];
			})[0];
		const index = document.screens.findIndex((item) => item.id === screen?.id);
		let next =
			branch || screen?.next_screen_id
				? document.screens.find((item) => item.id === (branch || screen?.next_screen_id))
				: document.screens[index + 1];
		const visited = new Set<string>();
		while (next && !matchesScreen(next) && !visited.has(next.id)) {
			visited.add(next.id);
			const position = document.screens.findIndex((item) => item.id === next?.id);
			next = next.next_screen_id
				? document.screens.find((item) => item.id === next?.next_screen_id)
				: document.screens[position + 1];
		}
		if (next && visited.has(next.id)) next = undefined;
		if (next) {
			setScreenId(next.id);
			setOutcome("");
		} else setOutcome(t("Flow completed"));
	};
	const renderedBlock = (block: Block, interactive = true) => {
		const props = block.props;
		const size = typeof props.font_size === "number" ? props.font_size : undefined;
		const style = {
			textAlign: (["left", "center", "right"].includes(String(props.align))
				? props.align
				: "center") as "left" | "center" | "right",
			fontSize: size,
			padding: typeof props.padding === "number" ? props.padding : undefined,
		};
		const text = String(props.text ?? "").replace(/\{\{\s*(\w+)\s*\}\}/g, (token, key: string) =>
			String(answers[key] ?? (profile.field === key ? profile.value : token)),
		);
		const editable =
			interactive && mode === "Design" && ["heading", "text", "legal"].includes(block.type);
		const editing = {
			contentEditable: editable,
			suppressContentEditableWarning: true,
			onBlur: (event: React.FocusEvent<HTMLElement>) => {
				if (editable && event.currentTarget.innerText !== text)
					patch(block, { text: event.currentTarget.innerText });
			},
		};
		if (block.type === "question") {
			const attribute = String(props.attribute ?? block.id);
			const options = Array.isArray(props.options)
				? (props.options as Array<Record<string, unknown>>)
				: [];
			return (
				<div className="space-y-3">
					<p className="text-lg font-semibold">{text}</p>
					{options.map((option) => (
						<Button
							key={String(option.value)}
							className="w-full"
							variant={answers[attribute] === option.value ? "primary" : "outline"}
							aria-pressed={answers[attribute] === option.value}
							onClick={() => {
								setAnswers((value) => ({ ...value, [attribute]: String(option.value) }));
								if (mode !== "Preview") setBlockId(block.id);
							}}
						>
							{String(option.label ?? option.value)}
						</Button>
					))}
				</div>
			);
		}
		if (block.type === "marketing_consent")
			return (
				<Checkbox
					label={String(props.title ?? t("Receive product news"))}
					checked={answers[block.id] === true}
					onCheckedChange={(value) =>
						setAnswers((previous) => ({ ...previous, [block.id]: value === true }))
					}
				/>
			);
		if (block.type === "heading")
			return (
				<h2 {...editing} style={style} className="text-3xl font-semibold leading-tight">
					{text}
				</h2>
			);
		if (block.type === "text" || block.type === "legal")
			return (
				<p
					{...editing}
					style={style}
					className={block.type === "legal" ? "text-xs opacity-70" : "text-base leading-relaxed"}
				>
					{text}
				</p>
			);
		if (block.type === "image")
			return props.url ? (
				<img
					src={String(props.url)}
					alt={String(props.alt ?? "")}
					className="w-full object-cover"
					style={{ borderRadius: document.theme.corner_radius }}
				/>
			) : (
				<div className="grid h-36 place-items-center rounded-xl border border-dashed opacity-50">
					{t("Image")}
				</div>
			);
		if (block.type === "benefits")
			return (
				<ul className="space-y-3">
					{(Array.isArray(props.items) ? props.items : []).map((item, index) => (
						<li key={index}>✓ {String(item)}</li>
					))}
				</ul>
			);
		if (block.type === "product") {
			const offering = String(props.offering_identifier ?? "default");
			const packages = Array.isArray(props.package_identifiers) ? props.package_identifiers : [];
			const entries = (prices[offering] ?? []).filter(
				(price) => !packages.length || packages.includes(price.package_identifier),
			);
			return (
				<div className="space-y-3">
					{entries.length ? (
						entries.map((price) => (
							<div
								key={price.package_identifier}
								className="rounded-xl border p-4"
								style={{ borderColor: document.theme.accent_color }}
							>
								<p className="font-semibold">{price.display_name}</p>
								<div className="mt-3 flex justify-between">
									<strong>
										{price.price_micros !== null && price.currency
											? new Intl.NumberFormat(language, {
													style: "currency",
													currency: price.currency,
												}).format(price.price_micros / 1e6)
											: t("Store price")}
									</strong>
									<span className="text-xs">{price.billing_period}</span>
								</div>
								{price.trial_period && (
									<p className="mt-2 text-xs">
										{t("Trial")} · {price.trial_period}
									</p>
								)}
							</div>
						))
					) : (
						<div className="rounded-xl border p-4">
							<p className="font-semibold">{offering}</p>
							<p className="mt-2 text-sm">{catalogError || t("No price for this store")}</p>
						</div>
					)}
				</div>
			);
		}

		if (block.type === "spacer") return <div style={{ height: Number(props.height ?? 24) }} />;
		if (block.type === "button")
			return (
				<Button
					className="w-full"
					variant="primary"
					style={{
						background: document.theme.accent_color,
						borderRadius: document.theme.corner_radius,
					}}
					onClick={() => action(block)}
				>
					{text}
				</Button>
			);
		if (block.type === "close")
			return (
				<div className="flex justify-end">
					<Button aria-label={t("close")} variant="ghost" onClick={() => action(block)}>
						×
					</Button>
				</div>
			);
		return null;
	};
	const makeTemplate = (variant: string) =>
		updateScreen((value) => ({
			...value,
			blocks: [
				...(variant === "Editorial"
					? [{ id: id(), type: "image" as const, props: { url: "", alt: "" } }]
					: []),
				{
					id: id(),
					type: "heading",
					props: {
						text: contentText(kind === "paywall" ? "Make it yours" : "Welcome"),
						align: "center",
						font_size: 32,
					},
				},
				{
					id: id(),
					type: "text",
					props: { text: contentText("Discover your next step"), align: "center" },
				},
				...(kind === "paywall"
					? [
							{
								id: id(),
								type: "product" as const,
								props: {
									offering_identifier: "default",
									style: variant === "Comparison" ? "cards" : "list",
									package_identifiers: [],
								},
							},
						]
					: [
							{
								id: id(),
								type: "benefits" as const,
								props: { items: [contentText("Make it yours")] },
							},
						]),
				{
					id: id(),
					type: "button",
					props: {
						text: contentText(kind === "paywall" ? "Subscribe" : "Continue"),
						action: kind === "paywall" ? "purchase" : "next",
					},
				},
				...(kind === "paywall"
					? [
							{
								id: id(),
								type: "button" as const,
								props: { text: contentText("Restore purchases"), action: "restore" },
							},
							{
								id: id(),
								type: "legal" as const,
								props: { text: contentText("Terms and privacy") },
							},
						]
					: []),
			],
		}));
	return (
		<section className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base text-kumo-default">
			<header
				style={previewOnly ? { display: "none" } : undefined}
				className="flex flex-wrap items-center justify-between gap-3 border-b border-kumo-line p-3"
			>
				<nav className="flex gap-1">
					{["Design", ...(kind === "onboarding" ? ["Journey"] : []), "Languages", "Preview"].map(
						(item) => (
							<Button
								key={item}
								variant={mode === item ? "secondary" : "ghost"}
								aria-pressed={mode === item}
								onClick={() => {
									setMode(item);
									if (item === "Design") setLanguage(translation.source_locale);
									setOutcome("");
								}}
							>
								{t(item)}
							</Button>
						),
					)}
				</nav>
				<div className="flex gap-2">
					<Button
						disabled={!history.past.length}
						onClick={() =>
							setHistory((value) => ({
								past: value.past.slice(0, -1),
								value: value.past.at(-1)!,
								future: [value.value, ...value.future],
							}))
						}
					>
						{t("Undo")}
					</Button>
					<Button
						disabled={!history.future.length}
						onClick={() =>
							setHistory((value) => ({
								past: [...value.past, value.value],
								value: value.future[0]!,
								future: value.future.slice(1),
							}))
						}
					>
						{t("Redo")}
					</Button>
					<Select
						aria-label={t("Device")}
						value={device}
						onValueChange={(value) => value && setDevice(value)}
						items={{ Phone: t("Phone"), Tablet: t("Tablet") }}
					/>
				</div>
			</header>
			{issues.length > 0 && (
				<div
					role="alert"
					className="space-y-1 border-b border-kumo-line p-3 text-sm text-kumo-danger"
				>
					{issues.map((issue) => (
						<p key={issue}>{t(issue)}</p>
					))}
				</div>
			)}
			{kind === "onboarding" && (
				<div className="flex items-center gap-2 overflow-auto border-b border-kumo-line p-3">
					{document.screens.map((item, index) => (
						<Button
							key={item.id}
							variant={item.id === screen?.id ? "secondary" : "ghost"}
							onClick={() => {
								setScreenId(item.id);
								setBlockId("");
							}}
						>
							{index + 1}. {item.name}
						</Button>
					))}
					<Button
						onClick={() => {
							const next: Screen = {
								id: id(),
								name: contentText("Welcome"),
								blocks: [
									{ id: id(), type: "heading", props: { text: contentText("Welcome") } },
									{
										id: id(),
										type: "button",
										props: { text: contentText("Continue"), action: "next" },
									},
								],
							};
							update((value) => ({ ...value, screens: [...value.screens, next] }));
							setScreenId(next.id);
						}}
					>
						{t("Add screen")}
					</Button>
				</div>
			)}
			{mode === "Journey" ? (
				<ExperienceFlowCanvas
					screens={previewDocument.screens}
					positions={
						(document.metadata.editor_positions ?? {}) as Record<string, { x: number; y: number }>
					}
					t={t}
					onSelect={(id) => {
						setScreenId(id);
						setMode("Design");
					}}
					onConnect={(from, to) =>
						update((value) => ({
							...value,
							screens: value.screens.map((screen) =>
								screen.id === from ? { ...screen, next_screen_id: to } : screen,
							),
						}))
					}
					onPosition={(id, position) =>
						update((value) => ({
							...value,
							metadata: {
								...value.metadata,
								editor_positions: {
									...((value.metadata.editor_positions as Record<string, unknown>) ?? {}),
									[id]: position,
								},
							},
						}))
					}
					preview={(item) => (
						<div
							className="space-y-3"
							style={{
								background: document.theme.background_color,
								color: document.theme.text_color,
							}}
						>
							{item.blocks.map((block) => (
								<div key={block.id}>{renderedBlock(block as Block, false)}</div>
							))}
						</div>
					)}
				/>
			) : (
				<div
					className={
						previewOnly
							? "grid min-h-[640px]"
							: "grid min-h-[640px] lg:grid-cols-[185px_minmax(300px,1fr)_280px]"
					}
				>
					<aside hidden={previewOnly} className="space-y-4 border-e border-kumo-line p-3">
						<p className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
							{t("Blocks")}
						</p>
						<div className="flex flex-wrap gap-2">
							{types
								.filter(
									(type) =>
										kind === "onboarding" ||
										!["benefits", "question", "marketing_consent"].includes(type),
								)
								.map((type) => (
									<Button key={type} size="sm" variant="outline" onClick={() => add(type)}>
										{t(type)}
									</Button>
								))}
						</div>
						<p className="pt-3 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
							{t("Layers")}
						</p>
						{screen?.blocks.map((block) => (
							<div
								key={block.id}
								draggable
								onDragStart={(event) => event.dataTransfer.setData("text/plain", block.id)}
								onDragOver={(event) => event.preventDefault()}
								onDrop={(event) => {
									event.preventDefault();
									const from = screen.blocks.findIndex(
										(item) => item.id === event.dataTransfer.getData("text/plain"),
									);
									const to = screen.blocks.findIndex((item) => item.id === block.id);
									if (from >= 0) move(screen.blocks[from]!.id, to - from);
								}}
								className="space-y-1 rounded-lg border border-kumo-line p-1"
							>
								<Button
									variant={selected?.id === block.id ? "secondary" : "ghost"}
									size="sm"
									className="w-full justify-start truncate"
									onClick={() => setBlockId(block.id)}
								>
									{t(block.type)}
								</Button>
								<div className="flex justify-end gap-1">
									<Button size="xs" aria-label={t("Move up")} onClick={() => move(block.id, -1)}>
										↑
									</Button>
									<Button size="xs" aria-label={t("Move down")} onClick={() => move(block.id, 1)}>
										↓
									</Button>
								</div>
							</div>
						))}
						<p className="pt-3 text-xs font-semibold">{t("Templates")}</p>
						{["Minimal", "Comparison", "Editorial"].map((item) => (
							<Button key={item} size="sm" className="w-full" onClick={() => makeTemplate(item)}>
								{t(item)}
							</Button>
						))}
					</aside>
					<main className="overflow-auto bg-kumo-tint p-5">
						<div
							className="mx-auto min-h-[580px] overflow-hidden rounded-[32px] border-4 border-kumo-line shadow-lg"
							style={{
								width: device === "Phone" ? 340 : 520,
								maxWidth: "100%",
								background: document.theme.background_color,
								color: document.theme.text_color,
								fontFamily: document.theme.font_family,
							}}
						>
							<div
								className="space-y-4 p-6"
								dir={/^(ar|fa|he|ur)(-|$)/.test(language) ? "rtl" : "ltr"}
							>
								{outcome ? (
									<div className="space-y-5 py-20 text-center">
										<p>{outcome}</p>
										<Button
											onClick={() => {
												setOutcome("");
												setScreenId(document.screens[0]?.id ?? "");
											}}
										>
											{t("Restart")}
										</Button>
									</div>
								) : (
									previewScreen?.blocks.map((block) => (
										<div
											key={block.id}
											role={mode === "Design" ? "group" : undefined}
											tabIndex={mode === "Design" ? 0 : undefined}
											aria-label={t(block.type)}
											onClick={() => mode === "Design" && setBlockId(block.id)}
											onKeyDown={(event) => {
												if (event.key === "Enter") setBlockId(block.id);
											}}
											className={
												selected?.id === block.id && mode === "Design"
													? "rounded-md outline-2 outline-offset-4 outline-kumo-brand"
													: ""
											}
										>
											{renderedBlock(block)}
										</div>
									))
								)}
							</div>
						</div>
					</main>
					<aside hidden={previewOnly} className="space-y-4 border-s border-kumo-line p-4">
						{mode === "Languages" ? (
							<>
								<div className="space-y-2">
									{t("Source language")} · {translation.source_locale}
									<Select
										aria-label={t("Source language")}
										value={translation.source_locale}
										onValueChange={(language) => {
											if (!language) return;
											update((value) => {
												const translations = experienceTranslations(value.metadata);
												const previous = translations.source_locale;
												translations.source_locale = language;
												if (translations.fallback_locale === previous)
													translations.fallback_locale = language;
												value.metadata.localization = translations;
												return value;
											});
											setLanguage(language);
										}}
										items={Object.fromEntries(
											[
												...new Set([
													"en",
													"fr",
													translation.source_locale,
													...Object.keys(translation.locales),
												]),
											].map((language) => [language, language.toUpperCase()]),
										)}
									/>
								</div>
								<Select
									label={t("Languages")}
									value={language}
									onValueChange={(value) => value && setLanguage(value)}
									items={Object.fromEntries(
										[
											...new Set([translation.source_locale, ...Object.keys(translation.locales)]),
										].map((key) => [key, key.toUpperCase()]),
									)}
								/>
								<Input
									label={t("Language code")}
									value={languageInput}
									onChange={(event) => setLanguageInput(event.target.value)}
								/>
								<Button
									onClick={() => {
										const key = canonicalEmailLocale(languageInput);
										if (!key) return;
										update((value) => {
											const translations = experienceTranslations(value.metadata);
											translations.locales[key] = {};
											value.metadata.localization = translations;
											return value;
										});
										setLanguage(key);
										setLanguageInput("");
									}}
								>
									{t("Add language")}
								</Button>
								<Select
									label={t("Fallback language")}
									value={translation.fallback_locale}
									onValueChange={(value) =>
										value &&
										update((draft) => {
											const translations = experienceTranslations(draft.metadata);
											translations.fallback_locale = value;
											draft.metadata.localization = translations;
											return draft;
										})
									}
									items={Object.fromEntries(
										[
											...new Set([translation.source_locale, ...Object.keys(translation.locales)]),
										].map((key) => [key, key.toUpperCase()]),
									)}
								/>
								{screen?.blocks.map((block) => {
									const translationKey =
										kind === "onboarding" ? String(screen.id) + "/" + block.id : block.id;
									const translated = translation.locales[language]?.[translationKey] ?? {};
									return (
										<div key={block.id} className="space-y-3 border-t border-kumo-line pt-3">
											<p className="text-xs font-semibold">{t(block.type)}</p>
											{["text", "title", "body", "alt", "url", "required_message"]
												.filter((key) => typeof block.props[key] === "string")
												.map((key) => (
													<InputArea
														key={key}
														label={String(block.props[key]) || t(key)}
														value={String(translated[key] ?? block.props[key])}
														onChange={(event) => patch(block, { [key]: event.target.value })}
													/>
												))}
											{block.type === "question" &&
												(Array.isArray(block.props.options)
													? (block.props.options as Array<Record<string, unknown>>)
													: []
												).map((option, index) => {
													const labels = Array.isArray(translated.options)
														? (translated.options as Array<Record<string, unknown>>)
														: [];
													return (
														<Input
															key={String(option.value)}
															label={String(option.label)}
															value={String(
																labels.find((value) => value.value === option.value)?.label ??
																	option.label,
															)}
															onChange={(event) =>
																patch(block, {
																	options: (
																		block.props.options as Array<Record<string, unknown>>
																	).map((item, position) => ({
																		...item,
																		label:
																			position === index
																				? event.target.value
																				: (labels.find((value) => value.value === item.value)
																						?.label ?? item.label),
																	})),
																})
															}
														/>
													);
												})}
										</div>
									);
								})}
							</>
						) : (
							<>
								{kind === "onboarding" && screen && (
									<>
										<Input
											label={t("Screen name")}
											value={screen.name}
											onChange={(event) =>
												updateScreen((value) => ({ ...value, name: event.target.value }))
											}
										/>
										<Select
											label={t("Next screen")}
											value={screen.next_screen_id ?? ""}
											onValueChange={(value) =>
												updateScreen((item) => ({ ...item, next_screen_id: value || null }))
											}
											items={{
												"": t("Automatic next"),
												...Object.fromEntries(
													document.screens
														.filter((item) => item.id !== screen.id)
														.map((item) => [item.id, item.name]),
												),
											}}
										/>
									</>
								)}
								{kind === "onboarding" && screen && (
									<details className="space-y-3 rounded-lg border border-kumo-line p-3">
										<summary>{t("Screen settings")}</summary>
										<div className="flex flex-wrap gap-1">
											<Button size="sm" onClick={() => moveScreen(-1)}>
												{t("Move up")}
											</Button>
											<Button size="sm" onClick={() => moveScreen(1)}>
												{t("Move down")}
											</Button>
											<Button
												size="sm"
												onClick={() => {
													const copy = structuredClone(screen);
													copy.id = id();
													copy.blocks = copy.blocks.map((block) => ({ ...block, id: id() }));
													update((value) => ({ ...value, screens: [...value.screens, copy] }));
													setScreenId(copy.id);
												}}
											>
												{t("Duplicate")}
											</Button>
											<Button
												size="sm"
												variant="secondary-destructive"
												disabled={document.screens.length < 2}
												onClick={() => {
													const removed = screen.id;
													update((value) => ({
														...value,
														screens: value.screens
															.filter((item) => item.id !== removed)
															.map((item) => ({
																...item,
																...(item.next_screen_id === removed
																	? { next_screen_id: undefined }
																	: {}),
															})),
													}));
													setScreenId(document.screens.find((item) => item.id !== removed)!.id);
												}}
											>
												{t("Delete")}
											</Button>
										</div>
										{["platform", "locale", "min_app_version"].map((key) => (
											<Input
												key={key}
												label={t(
													key === "platform"
														? "Platform"
														: key === "locale"
															? "Locale"
															: "Minimum app version",
												)}
												value={String(screen.conditions?.[key] ?? "")}
												onChange={(event) =>
													updateScreen((value) => {
														const conditions = { ...value.conditions };
														if (event.target.value) conditions[key] = event.target.value;
														else delete conditions[key];
														return { ...value, conditions };
													})
												}
											/>
										))}
									</details>
								)}
								{selected ? (
									<>
										<h3 className="font-semibold">{t(selected.type)}</h3>
										{typeof selected.props.text === "string" && (
											<InputArea
												label={t("Text")}
												value={String(
													translation.locales[language]?.[
														kind === "onboarding"
															? String(screen?.id) + "/" + selected.id
															: selected.id
													]?.text ?? selected.props.text,
												)}
												onChange={(event) => patch(selected, { text: event.target.value })}
											/>
										)}{" "}
										{selected.type === "image" && (
											<>
												<Input
													label={t("Image URL")}
													value={String(selected.props.url ?? "")}
													onChange={(event) => patch(selected, { url: event.target.value })}
												/>
												<Input
													label={t("Alternative text")}
													value={String(selected.props.alt ?? "")}
													onChange={(event) => patch(selected, { alt: event.target.value })}
												/>
											</>
										)}
										{selected.type === "product" && (
											<>
												<Input
													label={t("Offering identifier")}
													value={String(selected.props.offering_identifier ?? "")}
													onChange={(event) =>
														patch(selected, { offering_identifier: event.target.value })
													}
												/>
												<Input
													label={t("Package identifiers")}
													value={(Array.isArray(selected.props.package_identifiers)
														? selected.props.package_identifiers
														: []
													).join(", ")}
													onChange={(event) =>
														patch(selected, {
															package_identifiers: event.target.value
																.split(",")
																.map((item) => item.trim())
																.filter(Boolean),
														})
													}
												/>
											</>
										)}
										{selected.type === "question" && (
											<div className="space-y-3">
												<Input
													label={t("Answer attribute")}
													value={String(selected.props.attribute ?? "")}
													onChange={(event) => patch(selected, { attribute: event.target.value })}
												/>
												<Checkbox
													label={t("Required answer")}
													checked={selected.props.required === true}
													onCheckedChange={(value) => patch(selected, { required: value === true })}
												/>
												{(Array.isArray(selected.props.options)
													? (selected.props.options as Array<Record<string, unknown>>)
													: []
												).map((option, index) => (
													<div
														key={String(option.value)}
														className="space-y-2 rounded-lg border border-kumo-line p-3"
													>
														<Input
															label={t("Option label")}
															value={String(option.label ?? "")}
															onChange={(event) =>
																patch(selected, {
																	options: (
																		selected.props.options as Array<Record<string, unknown>>
																	).map((item, position) =>
																		position === index
																			? { ...item, label: event.target.value }
																			: item,
																	),
																})
															}
														/>
														<Select
															label={t("After this answer")}
															value={String(option.next_screen_id ?? "")}
															onValueChange={(value) =>
																patch(selected, {
																	options: (
																		selected.props.options as Array<Record<string, unknown>>
																	).map((item, position) =>
																		position === index
																			? { ...item, next_screen_id: value || undefined }
																			: item,
																	),
																})
															}
															items={{
																"": t("Automatic next"),
																...Object.fromEntries(
																	document.screens
																		.filter((item) => item.id !== screen?.id)
																		.map((item) => [item.id, item.name]),
																),
															}}
														/>
														<Button
															size="sm"
															variant="ghost"
															onClick={() =>
																patch(selected, {
																	options: (
																		selected.props.options as Array<Record<string, unknown>>
																	).filter((_, position) => position !== index),
																})
															}
														>
															{t("Delete")}
														</Button>
													</div>
												))}
												<Button
													onClick={() =>
														patch(selected, {
															options: [
																...(Array.isArray(selected.props.options)
																	? selected.props.options
																	: []),
																{ value: id(), label: t("Option label") },
															],
														})
													}
												>
													{t("Add option")}
												</Button>
											</div>
										)}
										{selected.type === "marketing_consent" && (
											<>
												<Input
													label={t("Text")}
													value={String(selected.props.title ?? "")}
													onChange={(event) => patch(selected, { title: event.target.value })}
												/>
												<InputArea
													label={t("Description")}
													value={String(selected.props.body ?? "")}
													onChange={(event) => patch(selected, { body: event.target.value })}
												/>
												<Input
													label={t("Lists")}
													value={(Array.isArray(selected.props.list_ids)
														? selected.props.list_ids
														: []
													).join(",")}
													onChange={(event) =>
														patch(selected, {
															list_ids: event.target.value
																.split(",")
																.map((item) => item.trim())
																.filter(Boolean),
														})
													}
												/>
											</>
										)}
										{selected.type === "spacer" && (
											<Input
												label={t("Height")}
												type="number"
												min={4}
												max={200}
												value={Number(selected.props.height ?? 24)}
												onChange={(event) =>
													patch(selected, { height: Number(event.target.value) })
												}
											/>
										)}
										{selected.type === "image" && (
											<Select
												label={t("Aspect ratio")}
												value={String(selected.props.aspect_ratio ?? "16/9")}
												onValueChange={(value) => patch(selected, { aspect_ratio: value })}
												items={{ "16/9": "16:9", "4/3": "4:3", "1/1": "1:1", "9/16": "9:16" }}
											/>
										)}
										{selected.type === "close" && (
											<Input
												label={t("Accessibility label")}
												value={String(selected.props.accessibility_label ?? t("close"))}
												onChange={(event) =>
													patch(selected, { accessibility_label: event.target.value })
												}
											/>
										)}
										{selected.type === "benefits" && (
											<InputArea
												label={t("benefits")}
												value={(Array.isArray(selected.props.items)
													? selected.props.items
													: []
												).join("\n")}
												onChange={(event) =>
													patch(selected, { items: event.target.value.split("\n") })
												}
											/>
										)}
										<Select
											label={t("Alignment")}
											value={String(selected.props.align ?? "center")}
											onValueChange={(value) => patch(selected, { align: value })}
											items={{ left: t("left"), center: t("center"), right: t("right") }}
										/>
										<Input
											label={t("Font size")}
											type="number"
											min={12}
											max={64}
											value={Number(selected.props.font_size ?? 16)}
											onChange={(event) =>
												patch(selected, { font_size: Number(event.target.value) })
											}
										/>
										{selected.type === "button" && (
											<Select
												label={t("Action")}
												value={String(selected.props.action ?? "next")}
												onValueChange={(value) => patch(selected, { action: value })}
												items={Object.fromEntries(
													["next", "purchase", "restore", "dismiss", "complete"].map((key) => [
														key,
														t(key),
													]),
												)}
											/>
										)}
										<div className="flex gap-2">
											<Button
												onClick={() =>
													updateScreen((value) => ({
														...value,
														blocks: [...value.blocks, { ...structuredClone(selected), id: id() }],
													}))
												}
											>
												{t("Duplicate")}
											</Button>
											<Button
												variant="secondary-destructive"
												onClick={() => {
													updateScreen((value) => ({
														...value,
														blocks: value.blocks.filter((item) => item.id !== selected.id),
													}));
													setBlockId("");
												}}
											>
												{t("Delete")}
											</Button>
										</div>
									</>
								) : (
									<p className="text-sm text-kumo-subtle">{t("Select a block")}</p>
								)}
								<div className="space-y-3 border-t border-kumo-line pt-4">
									<h3 className="font-semibold">{t("Theme")}</h3>
									{kind === "onboarding" && (
										<Checkbox
											label={t("Resume progress")}
											checked={document.metadata.resume_progress === true}
											onCheckedChange={(enabled) =>
												update((value) => ({
													...value,
													metadata: { ...value.metadata, resume_progress: enabled === true },
												}))
											}
										/>
									)}
									<Input
										label={t("Font")}
										value={document.theme.font_family}
										onChange={(event) =>
											update((value) => ({
												...value,
												theme: { ...value.theme, font_family: event.target.value },
											}))
										}
									/>
									{(
										[
											["accent_color", "Accent color"],
											["background_color", "Background"],
											["text_color", "Text color"],
										] as const
									).map(([key, label]) => (
										<Input
											key={key}
											type="color"
											label={t(label)}
											value={document.theme[key]}
											onChange={(event) =>
												update((value) => ({
													...value,
													theme: { ...value.theme, [key]: event.target.value },
												}))
											}
										/>
									))}
									<Input
										type="number"
										min={0}
										max={48}
										label={t("Radius")}
										value={document.theme.corner_radius}
										onChange={(event) =>
											update((value) => ({
												...value,
												theme: { ...value.theme, corner_radius: Number(event.target.value) },
											}))
										}
									/>
								</div>
								{mode === "Preview" && (
									<>
										<Select
											label={t("Platform")}
											value={profile.platform}
											onValueChange={(value) =>
												value && setProfile({ ...profile, platform: value })
											}
											items={{ ios: "iOS", android: "Android", web: "Web" }}
										/>
										<Input
											label={t("App version")}
											value={profile.app_version}
											onChange={(event) =>
												setProfile({ ...profile, app_version: event.target.value })
											}
										/>
										<Input
											label={t("Profile attribute")}
											value={profile.field}
											onChange={(event) => setProfile({ ...profile, field: event.target.value })}
										/>
										<Input
											label={t("Expected value")}
											value={profile.value}
											onChange={(event) => setProfile({ ...profile, value: event.target.value })}
										/>
									</>
								)}
							</>
						)}
					</aside>
				</div>
			)}
		</section>
	);
}
