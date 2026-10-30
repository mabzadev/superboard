import { Button } from "@superboard/front-ui/ui/button.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { useEffect, useState } from "react";

import {
	getStripeConnection,
	saveStripeConnection,
	testStripeConnection,
	type StripeConnection,
} from "./billing/api/billing/billingService.js";
import { useMonetizationI18n } from "./i18n.js";

export default function StripeSettings({ projectId }: { projectId: string }) {
	const { t } = useMonetizationI18n();
	const [connection, setConnection] = useState<StripeConnection | null>(null);
	const [secret, setSecret] = useState("");
	const [signing, setSigning] = useState("");
	const [origin, setOrigin] = useState("");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		let active = true;
		getStripeConnection(projectId)
			.then((result) => {
				if (active) {
					setConnection(result);
					setOrigin(result.application_origin);
				}
			})
			.catch(() => {
				if (active) setMessage(t("Unable to load Stripe settings."));
			});
		return () => {
			active = false;
		};
	}, [projectId, attempt, t]);
	async function save() {
		setBusy(true);
		setMessage("");
		try {
			await saveStripeConnection(projectId, {
				secret_key: secret,
				webhook_secret: signing,
				application_origin: origin,
			});
			setConnection(await getStripeConnection(projectId));
			setSecret("");
			setSigning("");
			setMessage(t("Settings saved."));
		} catch {
			setMessage(t("Unable to save Stripe settings. Check the keys and application origin."));
		} finally {
			setBusy(false);
		}
	}
	async function test() {
		setBusy(true);
		setMessage("");
		try {
			await testStripeConnection(projectId);
			setConnection(await getStripeConnection(projectId));
			setMessage(t("Store connection verified."));
		} catch {
			setMessage(t("Store connection failed. Check the application credentials and try again."));
		} finally {
			setBusy(false);
		}
	}
	return (
		<section className="space-y-4 rounded-lg border p-4">
			<h2 className="font-semibold">{t("Stripe web payments")}</h2>
			{message && <p role="status">{message}</p>}
			{!connection ? (
				<Button
					onClick={() => {
						setAttempt((value) => value + 1);
					}}
				>
					{t("Retry")}
				</Button>
			) : (
				<>
					<p>
						{t(connection.configured ? "Configured" : "Not configured")} ·{" "}
						{t(connection.environment === "sandbox" ? "Sandbox" : "Production")}
					</p>
					<form
						className="grid max-w-2xl gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							save().catch(() => {
								setMessage(
									t("Unable to save Stripe settings. Check the keys and application origin."),
								);
							});
						}}
					>
						<fieldset disabled={busy} className="grid gap-3">
							<label className="grid gap-1">
								{t("Application origin")}
								<Input
									required
									type="url"
									value={origin}
									onChange={(event) => {
										setOrigin(event.target.value);
									}}
								/>
							</label>
							<label className="grid gap-1">
								{t("Stripe secret key")}
								<Input
									required
									type="password"
									autoComplete="off"
									value={secret}
									onChange={(event) => {
										setSecret(event.target.value);
									}}
								/>
							</label>
							<label className="grid gap-1">
								{t("Webhook signing secret")}
								<Input
									required
									type="password"
									autoComplete="off"
									value={signing}
									onChange={(event) => {
										setSigning(event.target.value);
									}}
								/>
							</label>
							<Button type="submit">{t(busy ? "Saving…" : "Save changes")}</Button>
						</fieldset>
					</form>
					<p>{t("Stripe webhook endpoint")}</p>
					<code className="block break-all">{connection.webhook_path}</code>
					<p>
						{t(
							"Enable Checkout session, subscription, invoice payment and charge refund events on this endpoint.",
						)}
					</p>
					<Button
						variant="outline"
						disabled={busy || !connection.configured}
						onClick={() => {
							test().catch(() => {
								setMessage(
									t("Store connection failed. Check the application credentials and try again."),
								);
							});
						}}
					>
						{t("Test connection")}
					</Button>
				</>
			)}
		</section>
	);
}
