import { useFrontContext } from "@superboard/front-ui/context";
import { useState, type FormEvent } from "react";

import { Button } from "../../../../../supbrd-front-ui/src/shared/components/ui/button.js";
import { Input } from "../../../../../supbrd-front-ui/src/shared/components/ui/input.js";
import { useProjectSelection } from "../../../../../supbrd-front-ui/src/shared/context/useProjectSelection.js";
import EmailWorkspace from "../marketing/studio/EmailWorkspace.js";
import { useStudioI18n } from "../marketing/studio/i18n.js";
import { sendTransactionalEmail } from "./api/email/emailService.js";
import { EmailAdministration } from "./components/modules/EmailAdministration.js";
import { EmailMessages } from "./EmailMessages.js";

const messages = {
	en: {
		title: "Transactional email",
		recipient: "Recipient",
		subject: "Subject",
		body: "Message",
		send: "Send",
		sending: "Sending…",
		queued: "Message accepted for delivery",
		failure: "The message could not be sent",
	},
	fr: {
		title: "E-mail transactionnel",
		recipient: "Destinataire",
		subject: "Objet",
		body: "Message",
		send: "Envoyer",
		sending: "Envoi…",
		queued: "Message accepté pour livraison",
		failure: "Le message n’a pas pu être envoyé",
	},
};

export default function EmailPage() {
	const { activePluginIds } = useFrontContext();
	return activePluginIds.includes("supbrd-plugmod-marketing") ? (
		<EmailWorkspace initialTab="Deliveries" initialDeliverySource="transactional" />
	) : (
		<StandaloneEmailPage />
	);
}
function StandaloneEmailPage() {
	const { locale } = useFrontContext();
	const text = messages[locale];
	const { t } = useStudioI18n();
	const [tab, setTab] = useState("Messages");
	const { selectedProject } = useProjectSelection();
	const [recipient, setRecipient] = useState("");
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");
	const [busy, setBusy] = useState(false);
	const [queued, setQueued] = useState(false);
	const [error, setError] = useState<string | null>(null);
	async function submit(event: FormEvent) {
		event.preventDefault();
		if (!selectedProject || busy) return;
		setBusy(true);
		setQueued(false);
		setError(null);
		try {
			await sendTransactionalEmail(selectedProject.id, { to: recipient, subject, text: body });
			setQueued(true);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : text.failure);
		} finally {
			setBusy(false);
		}
	}
	return (
		<>
			<header className="space-y-4 p-6">
				<h1 className="text-2xl font-semibold">{t("Emails")}</h1>
				<nav className="flex gap-2">
					{["Messages", "Compose", "Settings"].map((key) => (
						<Button
							key={key}
							variant={tab === key ? "secondary" : "ghost"}
							onClick={() => setTab(key)}
						>
							{t(key)}
						</Button>
					))}
				</nav>
			</header>
			{tab === "Messages" && selectedProject && (
				<section className="p-6">
					<EmailMessages project={selectedProject.id} />
				</section>
			)}
			{tab === "Settings" && <EmailAdministration />}
			{tab === "Compose" && (
				<section className="mx-auto grid w-full max-w-3xl gap-4 p-6">
					<h2 className="text-lg font-semibold">{text.title}</h2>
					{error && <p role="alert">{error}</p>}
					{queued && <p role="status">{text.queued}</p>}
					<form className="grid gap-3" onSubmit={submit}>
						<label>
							{text.recipient}
							<Input
								type="email"
								name="recipient"
								value={recipient}
								onChange={(event) => setRecipient(event.target.value)}
								required
							/>
						</label>
						<label>
							{text.subject}
							<Input
								name="subject"
								value={subject}
								onChange={(event) => setSubject(event.target.value)}
								required
							/>
						</label>
						<label>
							{text.body}
							<textarea
								className="min-h-28 w-full rounded-md border bg-background p-3"
								name="body"
								value={body}
								onChange={(event) => setBody(event.target.value)}
								required
							/>
						</label>
						<Button type="submit" disabled={busy || !selectedProject}>
							{busy ? text.sending : text.send}
						</Button>
					</form>
				</section>
			)}
		</>
	);
}
