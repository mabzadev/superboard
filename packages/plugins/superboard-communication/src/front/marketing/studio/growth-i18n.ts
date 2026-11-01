import { useMemo } from "react";

import { useStudioI18n } from "./i18n.js";

/**
 * Copy for analytics, brand kit, A/B tests, local-time sending and native
 * automation triggers. Keys are the English copy; unknown keys fall back to
 * the shared Studio catalog.
 */
const fr: Record<string, string> = {
	"Brand kit": "Identité de marque",
	"New emails start with your logo, colors, font and footer. Each email can still change them.":
		"Les nouveaux e-mails reprennent votre logo, vos couleurs, votre police et votre pied de page. Chaque e-mail peut encore les modifier.",
	"Company name": "Nom de l’entreprise",
	"Logo URL": "URL du logo",
	"Logo preview": "Aperçu du logo",
	"Brand color": "Couleur de marque",
	"Text color": "Couleur du texte",
	Background: "Arrière-plan",
	"Content background": "Fond du contenu",
	Font: "Police",
	"Footer and social links": "Pied de page et réseaux sociaux",
	"Footer text": "Texte du pied de page",
	"Company address": "Adresse de l’entreprise",
	"Add a social link": "Ajouter un réseau social",
	"Choose a network": "Choisir un réseau",
	Remove: "Retirer",
	"Save brand kit": "Enregistrer l’identité de marque",
	"Brand kit saved": "Identité de marque enregistrée",
	"Apply brand kit": "Appliquer l’identité de marque",
	"Brand kit applied": "Identité de marque appliquée",
	"Revenue and time zones": "Revenus et fuseaux horaires",
	"Purchases are credited to the last email clicked within the attribution window.":
		"Les achats sont attribués au dernier e-mail cliqué pendant la fenêtre d’attribution.",
	"Attribution window (days)": "Fenêtre d’attribution (jours)",
	"Default time zone for contacts": "Fuseau horaire par défaut des contacts",
	"Preferences saved": "Préférences enregistrées",
	Save: "Enregistrer",
	"Save failed": "Échec de l’enregistrement",
	"Loading failed": "Échec du chargement",
	"Engagement and revenue": "Engagement et revenus",
	"Open rate": "Taux d’ouverture",
	"Click rate": "Taux de clic",
	"Unsubscribe rate": "Taux de désabonnement",
	"Bounce rate": "Taux de rebond",
	"Complaint rate": "Taux de plainte",
	"Attributed revenue": "Revenus attribués",
	Source: "Source",
	Purchases: "Achats",
	Campaign: "Campagne",
	Automation: "Automatisation",
	Link: "Lien",
	"Unique clicks": "Clics uniques",
	"Total clicks": "Clics totaux",
	CTR: "CTR",
	"No link clicks yet.": "Aucun clic sur un lien pour le moment.",
	"A/B test": "Test A/B",
	"Subject A is the subject above. Each variant goes to part of the test group.":
		"Le sujet A est celui ci-dessus. Chaque variante est envoyée à une partie du groupe de test.",
	"Subject {variant}": "Sujet {variant}",
	Email: "E-mail",
	"Same email": "Même e-mail",
	"Add variant C": "Ajouter la variante C",
	"Test group": "Groupe de test",
	Winner: "Gagnant",
	"Highest open rate": "Meilleur taux d’ouverture",
	"Highest click rate": "Meilleur taux de clic",
	"Test duration": "Durée du test",
	"1 hour": "1 heure",
	"4 hours": "4 heures",
	"12 hours": "12 heures",
	"24 hours": "24 heures",
	"{percent}% of the audience receives the variants. After the test, the winner is sent to everyone else.":
		"{percent} % de l’audience reçoit les variantes. Après le test, la gagnante est envoyée à tous les autres.",
	"A/B results": "Résultats A/B",
	Variant: "Variante",
	Subject: "Sujet",
	Recipients: "Destinataires",
	"Winner: {variant}": "Gagnante : {variant}",
	"Test running": "Test en cours",
	"Waiting to send": "En attente d’envoi",
	"Send at this local time in each contact's time zone":
		"Envoyer à cette heure locale dans le fuseau horaire de chaque contact",
	"Contacts without a time zone use the project time zone from Settings.":
		"Les contacts sans fuseau horaire utilisent celui du projet défini dans les paramètres.",
	"Local send time": "Heure locale d’envoi",
	Close: "Fermer",
	"Starts when": "Démarre quand",
	"Choose an event": "Choisir un événement",
	None: "Aucun",
	"Custom event from your application": "Événement personnalisé de votre application",
	"Event name": "Nom de l’événement",
	"Only for the list": "Uniquement pour la liste",
	"Any list": "N’importe quelle liste",
	"Only for the tag": "Uniquement pour le tag",
	"Any tag": "N’importe quel tag",
	"Contact date field": "Champ date du contact",
	"Days before the date": "Jours avant la date",
	"Sending hour (project time zone)": "Heure d’envoi (fuseau du projet)",
	"Every year (anniversary)": "Chaque année (anniversaire)",
	Subscriptions: "Abonnements",
	Acquisition: "Acquisition",
	Audience: "Audience",
	Dates: "Dates",
	"Purchase completed": "Achat effectué",
	"Refund issued": "Remboursement effectué",
	"Subscription started": "Abonnement démarré",
	"Subscription renewed": "Abonnement renouvelé",
	"Subscription cancelled": "Abonnement annulé",
	"Trial converted": "Essai converti",
	"Dynamic link opened in the app": "Lien dynamique ouvert dans l’application",
	"App installed from a link": "Application installée depuis un lien",
	"App installed": "Application installée",
	"Contact created": "Contact créé",
	"Contact joined a list": "Contact ajouté à une liste",
	"Tag added to a contact": "Tag ajouté à un contact",
	"Date or anniversary": "Date ou anniversaire",
	"Wait for event": "Attendre un événement",
	"Continue when an event happens, or after a time limit":
		"Continuer quand un événement se produit, ou après un délai maximal",
	"Wait until": "Attendre jusqu’à",
	"Time limit in hours": "Délai maximal en heures",
	"If the event happens": "Si l’événement se produit",
	"If the time limit is reached": "Si le délai maximal est atteint",
	"up to {hours} h": "jusqu’à {hours} h",
	"Goal (optional)": "Objectif (facultatif)",
	"Contacts who reach the goal leave the automation and count as converted.":
		"Les contacts qui atteignent l’objectif quittent l’automatisation et sont comptés comme convertis.",
	"Goal event": "Événement objectif",
};

function interpolate(template: string, values?: Record<string, string | number>) {
	return values
		? template.replace(/\{(\w+)\}/gu, (match, name: string) =>
				Object.hasOwn(values, name) ? String(values[name]) : match,
			)
		: template;
}

export function growthTranslator(
	locale: "en" | "fr",
	fallback: (key: string, values?: Record<string, string | number>) => string,
) {
	return (key: string, values?: Record<string, string | number>) =>
		Object.hasOwn(fr, key)
			? interpolate(locale === "fr" ? (fr[key] ?? key) : key, values)
			: fallback(key, values);
}

export function useGrowthI18n() {
	const studio = useStudioI18n();
	return {
		locale: studio.locale,
		t: useMemo(() => growthTranslator(studio.locale, studio.t), [studio.locale, studio.t]),
	};
}
