import { useMemo } from "react";

import { useStudioI18n } from "../../../marketing/studio/i18n.js";

/** French copy of the Email delivery settings (domain authentication, API keys, event webhooks). */
const fr: Record<string, string> = {
	"Domain authentication": "Authentification du domaine",
	"Add these DNS records at your DNS provider, then verify them.":
		"Ajoutez ces enregistrements DNS chez votre hébergeur DNS, puis vérifiez-les.",
	"SPF include of your provider (for example: _spf.provider.com)":
		"Include SPF de votre fournisseur (par exemple : _spf.provider.com)",
	"DKIM selector": "Sélecteur DKIM",
	"DKIM record type": "Type d’enregistrement DKIM",
	"TXT (public key)": "TXT (clé publique)",
	"CNAME (provider target)": "CNAME (cible du fournisseur)",
	"DKIM value from your provider": "Valeur DKIM fournie par votre fournisseur",
	"Amazon SES DKIM tokens (up to 3, comma separated)":
		"Jetons DKIM Amazon SES (3 maximum, séparés par des virgules)",
	"Custom MAIL FROM subdomain (optional, for example: mail.example.com)":
		"Sous-domaine MAIL FROM personnalisé (facultatif, par exemple : mail.example.com)",
	"DMARC report address (optional)": "Adresse des rapports DMARC (facultatif)",
	"Save DNS settings": "Enregistrer les paramètres DNS",
	"Verify records": "Vérifier les enregistrements",
	"DNS settings saved": "Paramètres DNS enregistrés",
	"DNS records checked": "Enregistrements DNS vérifiés",
	Type: "Type",
	Host: "Hôte",
	Value: "Valeur",
	Status: "Statut",
	Copy: "Copier",
	Copied: "Copié",
	"Copy {name}": "Copier {name}",
	Verified: "Vérifié",
	Missing: "Absent",
	"Wrong value": "Valeur incorrecte",
	"To complete": "À compléter",
	verified: "vérifié",
	missing: "absent",
	mismatch: "valeur incorrecte",
	unconfigured: "à compléter",
	unverified: "non vérifié",
	failed: "échec",
	unchecked: "non vérifié",
	"Not checked yet": "Pas encore vérifié",
	"Found: {value}": "Trouvé : {value}",
	"Ready to send": "Prêt pour l’envoi",
	"Not ready: fix the records marked above.":
		"Pas encore prêt : corrigez les enregistrements signalés ci-dessus.",
	"Last checked {date}": "Dernière vérification le {date}",
	"Open domain authentication for {name}": "Ouvrir l’authentification du domaine de {name}",
	"API keys": "Clés API",
	"Server keys for the transactional send API (POST /v1/email/send). Keep them on your server: never put them in a browser or mobile app.":
		"Clés serveur de l’API d’envoi transactionnel (POST /v1/email/send). Conservez-les sur votre serveur : ne les placez jamais dans un navigateur ou une application mobile.",
	"Key name": "Nom de la clé",
	"Create key": "Créer une clé",
	"API key created": "Clé API créée",
	"API key revoked": "Clé API révoquée",
	"Copy this key now. It will not be shown again.":
		"Copiez cette clé maintenant. Elle ne sera plus affichée.",
	"No API key yet.": "Aucune clé API pour le moment.",
	"Last used {date}": "Dernière utilisation le {date}",
	"Never used": "Jamais utilisée",
	"Revoke {name}": "Révoquer {name}",
	"Event webhooks": "Webhooks d’événements",
	"Receive signed delivery events (HMAC-SHA256 in X-SuperBoard-Signature) on your HTTPS endpoint.":
		"Recevez les événements d’envoi signés (HMAC-SHA256 dans X-SuperBoard-Signature) sur votre point de terminaison HTTPS.",
	"Endpoint URL (https://…)": "URL du point de terminaison (https://…)",
	"Add endpoint": "Ajouter le point de terminaison",
	"Webhook endpoint added": "Point de terminaison ajouté",
	"Webhook endpoint updated": "Point de terminaison mis à jour",
	"Webhook endpoint deleted": "Point de terminaison supprimé",
	"Copy this signing secret now. It will not be shown again.":
		"Copiez ce secret de signature maintenant. Il ne sera plus affiché.",
	"No webhook endpoint yet.": "Aucun point de terminaison pour le moment.",
	"Send test event": "Envoyer un événement de test",
	"Test event delivered (HTTP {status})": "Événement de test livré (HTTP {status})",
	"Test event failed: {error}": "Échec de l’événement de test : {error}",
	"Recent deliveries": "Livraisons récentes",
	"No delivery yet.": "Aucune livraison pour le moment.",
	"Delete {name}": "Supprimer {name}",
	"{count} attempts": "{count} tentatives",
	Sent: "Envoyé",
	Delivered: "Délivré",
	Bounced: "Rejeté (bounce)",
	Complained: "Plainte",
	Opened: "Ouvert",
	Clicked: "Cliqué",
	Failed: "Échec",
	Pending: "En attente",
	Retrying: "Nouvelle tentative",
	Test: "Test",
	Enabled: "Activé",
	Close: "Fermer",
	"No SPF record is published at this host.":
		"Aucun enregistrement SPF n’est publié pour cet hôte.",
	"Several SPF records exist; merge them into one (RFC 7208).":
		"Plusieurs enregistrements SPF existent ; fusionnez-les en un seul (RFC 7208).",
	"The SPF record authorizes every server (+all); use ~all or -all.":
		"L’enregistrement SPF autorise tous les serveurs (+all) ; utilisez ~all ou -all.",
	"A valid SPF record exists. Enter your provider's SPF include to also verify that it authorizes your provider.":
		"Un enregistrement SPF valide existe. Indiquez l’include SPF de votre fournisseur pour vérifier qu’il l’autorise.",
	"The SPF record does not include {include}. Use the suggested value.":
		"L’enregistrement SPF n’inclut pas {include}. Utilisez la valeur proposée.",
	"SPF authorizes your provider and is aligned with the sender domain.":
		"SPF autorise votre fournisseur et est aligné avec le domaine de l’expéditeur.",
	"SPF authorizes Amazon SES. Configure a custom MAIL FROM domain to align SPF; DMARC passes through DKIM.":
		"SPF autorise Amazon SES. Configurez un domaine MAIL FROM personnalisé pour aligner SPF ; DMARC est validé par DKIM.",
	"No MX record is published for the MAIL FROM domain.":
		"Aucun enregistrement MX n’est publié pour le domaine MAIL FROM.",
	"The MAIL FROM domain routes bounces to Amazon SES.":
		"Le domaine MAIL FROM achemine les rebonds vers Amazon SES.",
	"The MX record must point to {target}.": "L’enregistrement MX doit pointer vers {target}.",
	"Paste the DKIM details from your provider to generate this record.":
		"Collez les informations DKIM de votre fournisseur pour générer cet enregistrement.",
	"No CNAME record is published at this host.":
		"Aucun enregistrement CNAME n’est publié pour cet hôte.",
	"The DKIM CNAME points to your provider's signing key.":
		"Le CNAME DKIM pointe vers la clé de signature de votre fournisseur.",
	"The CNAME must point to {target}.": "Le CNAME doit pointer vers {target}.",
	"No DKIM public key is published at this host.":
		"Aucune clé publique DKIM n’est publiée pour cet hôte.",
	"The DKIM key is empty (revoked).": "La clé DKIM est vide (révoquée).",
	"The published DKIM public key differs from your provider's key.":
		"La clé publique DKIM publiée diffère de celle de votre fournisseur.",
	"The DKIM public key matches and signs for the sender domain.":
		"La clé publique DKIM correspond et signe pour le domaine de l’expéditeur.",
	"No DMARC record is published for the domain.":
		"Aucun enregistrement DMARC n’est publié pour le domaine.",
	"Several DMARC records exist; keep exactly one.":
		"Plusieurs enregistrements DMARC existent ; n’en conservez qu’un seul.",
	"The DMARC record must declare p=none, p=quarantine or p=reject.":
		"L’enregistrement DMARC doit déclarer p=none, p=quarantine ou p=reject.",
	"DMARC policy: p={policy}.": "Politique DMARC : p={policy}.",
	"DMARC policy inherited from {domain}: p={policy}.":
		"Politique DMARC héritée de {domain} : p={policy}.",
};

/** English labels of API values; they are translated through the dictionary above. */
export const EMAIL_VALUE_LABELS: Record<string, string> = {
	verified: "Verified",
	missing: "Missing",
	mismatch: "Wrong value",
	unconfigured: "To complete",
	sent: "Sent",
	delivered: "Delivered",
	bounced: "Bounced",
	complained: "Complained",
	opened: "Opened",
	clicked: "Clicked",
	failed: "Failed",
	pending: "Pending",
	retrying: "Retrying",
	test: "Test",
};

function interpolate(template: string, values?: Record<string, string | number>) {
	return values
		? template.replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token))
		: template;
}

/** Studio translations extended with the Email delivery settings copy. */
export function useEmailI18n() {
	const { locale, t } = useStudioI18n();
	const translate = useMemo(
		() => (key: string, values?: Record<string, string | number>) => {
			const own = locale === "fr" ? fr[key] : undefined;
			if (own !== undefined) return interpolate(own, values);
			const shared = t(key, values);
			return shared === key ? interpolate(key, values) : shared;
		},
		[locale, t],
	);
	return { locale, t: translate };
}
