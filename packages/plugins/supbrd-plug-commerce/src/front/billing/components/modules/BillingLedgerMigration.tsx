import { useFrontContext, usePluginEnabled } from "@superboard/front-ui/context";
import { useEffect, useState } from "react";

import { moduleErrorMessage } from "../../../../../../../supbrd-front-ui/src/shared/components/modules/ModulePage.js";
import { Button } from "../../../../../../../supbrd-front-ui/src/shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../../../../../../../supbrd-front-ui/src/shared/components/ui/card.js";
import {
	getBillingMigrationStatus,
	migrateProductsLedger,
	type BillingMigrationStatus,
} from "../../api/products/productsService.js";

export function BillingLedgerMigration({
	projectRef,
	onComplete,
}: {
	projectRef: string;
	onComplete(): void;
}) {
	const { locale } = useFrontContext();
	const sourceEnabled = usePluginEnabled("supbrd-plug-products");
	const [status, setStatus] = useState<BillingMigrationStatus>();
	const [pending, setPending] = useState(false);
	const [started, setStarted] = useState(false);
	const [error, setError] = useState<string>();
	const fr = locale === "fr";
	useEffect(() => {
		let disposed = false;
		void getBillingMigrationStatus(projectRef)
			.then((value) => {
				if (!disposed) {
					setStatus(value);
					setStarted(Boolean(value.table && (value.table !== "products" || value.cursor?.length)));
				}
			})
			.catch((cause) => {
				if (!disposed) setError(moduleErrorMessage(cause));
			});
		return () => {
			disposed = true;
		};
	}, [projectRef]);
	const migrate = async () => {
		setPending(true);
		setError(undefined);
		try {
			const next = await migrateProductsLedger(projectRef);
			setStatus(next);
			setStarted(true);
			if (next.complete) onComplete();
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		} finally {
			setPending(false);
		}
	};
	if (status?.complete) return null;
	return (
		<Card>
			<CardHeader>
				<CardTitle>{fr ? "Achats historiques" : "Historical purchases"}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<p>
					{fr
						? "Importez les achats et abonnements existants de Products. Vous pouvez reprendre un import interrompu."
						: "Import existing purchases and subscriptions from Products. An interrupted import can be resumed."}
				</p>
				{!sourceEnabled && (
					<p>
						{fr
							? "Activez Products pour importer son historique."
							: "Enable Products to import its history."}
					</p>
				)}
				{error && <p role="alert">{error}</p>}
				<Button disabled={pending || !sourceEnabled} onClick={() => void migrate()}>
					{pending
						? fr
							? "Import en cours…"
							: "Importing…"
						: started
							? fr
								? "Continuer l’import"
								: "Continue import"
							: fr
								? "Importer les achats historiques"
								: "Import historical purchases"}
				</Button>
			</CardContent>
		</Card>
	);
}
