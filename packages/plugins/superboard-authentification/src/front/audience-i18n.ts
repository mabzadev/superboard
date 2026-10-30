import { useFrontContext } from "@superboard/front-ui/context";
import { createFrontI18n } from "@superboard/front-ui/i18n";

const fr = {
	iOS: "iOS",
	Android: "Android",
	Web: "Web",
	Views: "Vues",
	Opens: "Ouvertures",
	Installs: "Installations",
	Reinstalls: "Réinstallations",
	Reactivations: "Réactivations",
	"Invited users": "Invitations",
	"Time spent": "Durée",
	Revenue: "Revenus",
	"SDK Identifier": "Identifiant SDK",
	"SDK identifier": "Identifiant SDK",
	Platform: "Plateforme",
	"Last access": "Dernier accès",
	Date: "Date",
	Id: "ID",
	unknown: "Inconnue",
	Unknown: "Inconnue",
	Unassigned: "Non attribué",
	Referrals: "Parrainages",
	"Search customer": "Rechercher un profil",
	"Search referral": "Rechercher un parrainage",
	"Add customer": "Ajouter un profil",
	"Customer details": "Détails du profil",
	"Customer updated": "Profil mis à jour",
	"Customer created": "Profil créé",
	"Customer deleted": "Profil supprimé",
	Name: "Nom",
	Email: "E-mail",
	"Country code": "Code du pays",
	"Saving…": "Enregistrement…",
	"Save customer": "Enregistrer",
	Delete: "Supprimer",
	Cancel: "Annuler",
	"No records yet": "Aucun résultat",
	"New records will appear here with their engagement and attribution metrics.":
		"Les nouveaux éléments apparaîtront ici avec leurs données d’activité et d’attribution.",
	"The SDK identifier is the stable acquisition identity for this project.":
		"L’identifiant SDK identifie ce profil de façon stable dans le projet.",
	"Referral codes, attributed customers and the complete conversion lifecycle.":
		"Codes de parrainage, profils associés et suivi des conversions.",
	"View {name}": "Consulter {name}",
};
const en = Object.fromEntries(Object.keys(fr).map((key) => [key, key]));
export function useAudienceI18n() {
	const { locale } = useFrontContext();
	return createFrontI18n({ locale, messages: { en, fr } });
}
