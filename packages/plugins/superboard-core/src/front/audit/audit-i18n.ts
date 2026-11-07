const en = {
	title: "Audit log",
	description: "Tamper-evident record of the operations run by plugins in this environment.",
	integrity: "Integrity",
	integrityDescription:
		"Imports the latest technical receipts and checks that the chain has not been altered.",
	chain: "Ledger chain",
	notVerified: "Not verified",
	verified: "Verified",
	failed: "Integrity failure",
	checked: "{count} receipts checked.",
	broken: "The chain breaks at sequence {sequence}.",
	more: "More technical receipts remain to synchronize.",
	verify: "Synchronize and verify",
	receipts: "Receipts",
	receiptsDescription: "Operations recorded in the ledger.",
	search: "Search receipts",
	sequence: "Sequence",
	operation: "Operation",
	action: "Action",
	status: "Status",
	"status:completed": "Completed",
	"status:succeeded": "Succeeded",
	"status:failed": "Failed",
	empty: "No receipts imported yet. Synchronize the technical journal to populate the ledger.",
	next: "Next page",
	start: "First page",
	advanced: "Advanced",
	advancedDescription: "Technical tools to keep the ledger over the long term.",
	archive: "Create immutable archive",
	archiveTitle: "Immutable archives",
	archiveDescription:
		"Freezes up to 1,000 consecutive verified receipts under a checksum. Verify the ledger first.",
	from: "First sequence",
	to: "Last sequence",
	archives: "Archives",
	noArchives: "No archive yet.",
	range: "Receipts {from} to {to}",
	checksum: "Checksum",
};

type AuditMessage = keyof typeof en;

const fr: Record<AuditMessage, string> = {
	title: "Journal d’audit",
	description:
		"Registre infalsifiable des opérations exécutées par les plugins de cet environnement.",
	integrity: "Intégrité",
	integrityDescription:
		"Importe les derniers reçus techniques et vérifie que la chaîne n’a pas été modifiée.",
	chain: "Chaîne du journal",
	notVerified: "Non vérifiée",
	verified: "Vérifiée",
	failed: "Intégrité compromise",
	checked: "{count} reçus vérifiés.",
	broken: "La chaîne est rompue à la séquence {sequence}.",
	more: "D’autres reçus techniques restent à synchroniser.",
	verify: "Synchroniser et vérifier",
	receipts: "Reçus",
	receiptsDescription: "Opérations enregistrées dans le journal.",
	search: "Rechercher des reçus",
	sequence: "Séquence",
	operation: "Opération",
	action: "Action",
	status: "État",
	"status:completed": "Terminée",
	"status:succeeded": "Réussie",
	"status:failed": "Échec",
	empty: "Aucun reçu importé. Synchronisez le journal technique pour alimenter l’audit.",
	next: "Page suivante",
	start: "Première page",
	advanced: "Avancé",
	advancedDescription: "Outils techniques pour conserver le journal sur le long terme.",
	archive: "Créer une archive immuable",
	archiveTitle: "Archives immuables",
	archiveDescription:
		"Fige jusqu’à 1 000 reçus vérifiés consécutifs sous une somme de contrôle. Vérifiez d’abord le journal.",
	from: "Première séquence",
	to: "Dernière séquence",
	archives: "Archives",
	noArchives: "Aucune archive pour l’instant.",
	range: "Reçus {from} à {to}",
	checksum: "Somme de contrôle",
};

const placeholder = /\{(\w+)\}/gu;

export function auditText(locale: string) {
	const catalog = locale === "fr" ? fr : en;
	return (key: AuditMessage, values: Record<string, string | number> = {}) =>
		catalog[key].replace(placeholder, (match, name: string) => String(values[name] ?? match));
}

export function isAuditStatus(
	status: string | undefined,
): status is "completed" | "succeeded" | "failed" {
	return status === "completed" || status === "succeeded" || status === "failed";
}
