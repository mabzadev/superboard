import { useFrontContext } from "@superboard/front-ui/context";
import { useState } from "react";

import { Button } from "../../../../../../supbrd-front-ui/src/shared/components/ui/button.js";
import { Input } from "../../../../../../supbrd-front-ui/src/shared/components/ui/input.js";
import { POST, PUT } from "./transport.js";

const messages = {
	en: {
		title: "Application account",
		name: "Display name",
		save: "Save name",
		reason: "Suspension reason",
		suspend: "Suspend account and revoke sessions",
		saved: "Application account updated",
		suspended: "Account suspended; existing sessions revoked",
	},
	fr: {
		title: "Compte de l’application",
		name: "Nom affiché",
		save: "Enregistrer le nom",
		reason: "Motif de suspension",
		suspend: "Suspendre le compte et révoquer les sessions",
		saved: "Compte de l’application modifié",
		suspended: "Compte suspendu ; sessions existantes révoquées",
	},
};
export default function ApplicationUserActions({
	projectRef,
	userId,
	name,
	onChange,
}: {
	projectRef: string;
	userId: string;
	name: string;
	onChange: () => Promise<void>;
}) {
	const { locale } = useFrontContext();
	const t = messages[locale];
	const [displayName, setDisplayName] = useState(name);
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const path = `/api/v1/application-users/projects/${encodeURIComponent(projectRef)}/profiles/${encodeURIComponent(userId)}`;
	async function run(suspend: boolean) {
		if (busy) return;
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			if (suspend) await POST(`${path}/suspend`, { user_id: userId, reason });
			else await PUT(path, { user_id: userId, display_name: displayName });
			await onChange();
			setNotice(suspend ? t.suspended : t.saved);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	}
	return (
		<section className="grid gap-4 rounded border p-4">
			<h3>{t.title}</h3>
			{error && <p role="alert">{error}</p>}
			{notice && <p role="status">{notice}</p>}
			<form
				onSubmit={(event) => {
					event.preventDefault();
					void run(false);
				}}
				className="flex items-end gap-3"
			>
				<label>
					{t.name}
					<Input
						required
						maxLength={120}
						value={displayName}
						onChange={(event) => setDisplayName(event.target.value)}
					/>
				</label>
				<Button disabled={busy || !displayName.trim()}>{t.save}</Button>
			</form>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					void run(true);
				}}
				className="flex items-end gap-3"
			>
				<label>
					{t.reason}
					<Input
						required
						maxLength={2000}
						value={reason}
						onChange={(event) => setReason(event.target.value)}
					/>
				</label>
				<Button variant="destructive" disabled={busy || !reason.trim()}>
					{t.suspend}
				</Button>
			</form>
		</section>
	);
}
