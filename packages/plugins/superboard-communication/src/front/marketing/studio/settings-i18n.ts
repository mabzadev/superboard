export const settingsFrench: Record<string, string> = {
	Advanced: "Avancé",
	Off: "Désactivé",
	"To complete": "À compléter",
	Reload: "Recharger",
	Unit: "Unité",
	hours: "heures",
	days: "jours",
	"Addresses your emails are sent from. Verify the domain of each sender so emails reach the inbox.":
		"Adresses depuis lesquelles vos e-mails sont envoyés. Vérifiez le domaine de chaque expéditeur pour que vos e-mails arrivent en boîte de réception.",
	"No sender yet. Add one, then verify its domain: emails cannot be delivered without it.":
		"Aucun expéditeur pour le moment. Ajoutez-en un, puis vérifiez son domaine : aucun e-mail ne peut être livré sans lui.",
	"Add a sender": "Ajouter un expéditeur",
	"New sender": "Nouvel expéditeur",
	"Add sender": "Ajouter l’expéditeur",
	"Delete sender": "Supprimer l’expéditeur",
	"Delete this sender?": "Supprimer cet expéditeur ?",
	"Emails can no longer be sent from {email}.":
		"Plus aucun e-mail ne pourra être envoyé depuis {email}.",
	"Name and address your recipients see.": "Nom et adresse que voient vos destinataires.",
	"Senders are used in priority order. A disabled sender is never used.":
		"Les expéditeurs sont utilisés par ordre de priorité. Un expéditeur désactivé n’est jamais utilisé.",
	"Internal name": "Nom interne",
	"Only shown in SuperBoard.": "Visible uniquement dans SuperBoard.",
	"Sending server": "Serveur d’envoi",
	"The SMTP server that delivers the emails of this sender.":
		"Le serveur SMTP qui livre les e-mails de cet expéditeur.",
	"Order and volume limits used when several senders are available.":
		"Ordre d’utilisation et limites de volume quand plusieurs expéditeurs sont disponibles.",
	"Senders with a lower number are used first.":
		"Les expéditeurs avec le plus petit nombre sont utilisés en premier.",
	"Leave empty for no limit.": "Laissez vide pour ne fixer aucune limite.",
	"Domain authentication · {domain}": "Authentification du domaine · {domain}",
	Verification: "Vérification",
	"Not ready": "Pas prêt",
	"Fix the records marked below.": "Corrigez les enregistrements signalés ci-dessous.",
	Revoke: "Révoquer",
	"Revoke this API key?": "Révoquer cette clé API ?",
	"Servers that still use it can no longer send emails.":
		"Les serveurs qui l’utilisent encore ne pourront plus envoyer d’e-mails.",
	"Add an endpoint": "Ajouter un point de terminaison",
	"New webhook endpoint": "Nouveau point de terminaison",
	"Choose the HTTPS address and the events it receives.":
		"Choisissez l’adresse HTTPS et les événements qu’elle reçoit.",
	"Events to send": "Événements à envoyer",
	"Delete this webhook endpoint?": "Supprimer ce point de terminaison ?",
	"This endpoint stops receiving delivery events.":
		"Ce point de terminaison ne recevra plus les événements d’envoi.",
	"Add a provider webhook": "Ajouter un webhook fournisseur",
	"New provider webhook": "Nouveau webhook fournisseur",
	"Each webhook receives the events of one service.":
		"Chaque webhook reçoit les événements d’un seul service.",
	"Delete this provider webhook?": "Supprimer ce webhook fournisseur ?",
	"Your provider will no longer be able to report bounces and complaints to this URL.":
		"Votre fournisseur ne pourra plus signaler les rebonds et les plaintes à cette URL.",
	"Delete channel": "Supprimer le canal",
	"Delete this channel?": "Supprimer ce canal ?",
	"Automation steps that use it can no longer deliver messages.":
		"Les étapes d’automatisation qui l’utilisent ne pourront plus livrer de messages.",
	"Automations can only use enabled channels.":
		"Les automatisations ne peuvent utiliser que les canaux activés.",
	"A JSON object of header names and values.":
		"Un objet JSON associant les noms d’en-têtes à leurs valeurs.",
	"Added at the bottom of new emails, above the unsubscribe link.":
		"Ajoutés en bas des nouveaux e-mails, au-dessus du lien de désinscription.",
	"Remove {network}": "Retirer {network}",
	"Languages your emails can be written in, and the one used when a translation is missing.":
		"Langues dans lesquelles vos e-mails peuvent être rédigés, et celle utilisée quand une traduction manque.",
	"Language codes separated by commas, for example: en, fr":
		"Codes de langue séparés par des virgules, par exemple : en, fr",
	"Choose a fallback language among the enabled languages.":
		"Choisissez une langue de repli parmi les langues activées.",
	"Terms kept unchanged when emails are translated, one per line.":
		"Termes conservés tels quels lors de la traduction des e-mails, un par ligne.",
	"Marketing email frequency": "Fréquence des e-mails marketing",
	"Avoid sending too many campaign and lifecycle emails to the same contact.":
		"Évitez d’envoyer trop d’e-mails de campagne et de cycle de vie au même contact.",
	"Limit marketing emails per contact": "Limiter les e-mails marketing par contact",
	"Minimum time between two marketing emails": "Délai minimum entre deux e-mails marketing",
	"Translate email content with your own AI provider.":
		"Traduisez le contenu des e-mails avec votre propre fournisseur d’IA.",
	"Remove the translation provider?": "Retirer le fournisseur de traduction ?",
	"Its encrypted API key is deleted. You will need to enter it again.":
		"Sa clé API chiffrée sera supprimée. Vous devrez la saisir à nouveau.",
	Webhooks: "Webhooks",
	"Delivery events come in from your email provider and go out to your own systems.":
		"Les événements d’envoi arrivent de votre fournisseur d’e-mail et repartent vers vos propres systèmes.",
	"Receive provider events": "Recevoir les événements du fournisseur",
	"Send events to your endpoints": "Envoyer les événements à vos points de terminaison",
	"Signed delivery events (HMAC-SHA256 in X-SuperBoard-Signature) are posted to your HTTPS endpoints.":
		"Les événements d’envoi signés (HMAC-SHA256 dans X-SuperBoard-Signature) sont envoyés à vos points de terminaison HTTPS.",
};
