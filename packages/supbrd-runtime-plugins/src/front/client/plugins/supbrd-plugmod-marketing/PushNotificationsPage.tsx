import { setupI18n } from "@lingui/core";
import { useFrontContext } from "@superboard/front-ui/context";
import { Button, Input } from "@superboard/front-ui/kumo";
import { useCallback, useEffect, useState } from "react";

import { useProjectSelection } from "../../../../../../supbrd-front-ui/src/shared/context/useProjectSelection.js";
import { POST } from "./transport.js";

const copy = {
	en: {
		title: "Push notifications",
		notification_title: "Title",
		body: "Message",
		create: "Create notification",
		created: "Notification created",
		empty: "No push notifications",
		failed: "The notification operation failed",
		next: "Next page",
		previous: "Previous page",
	},
	fr: {
		title: "Notifications push",
		notification_title: "Titre",
		body: "Message",
		create: "Créer la notification",
		created: "Notification créée",
		empty: "Aucune notification push",
		failed: "L’opération sur la notification a échoué",
		next: "Page suivante",
		previous: "Page précédente",
	},
};
interface Notification {
	id: string;
	title: string;
	subtitle: string;
	created_at: string;
}

export default function PushNotificationsPage() {
	const { locale } = useFrontContext();
	const { selectedProject } = useProjectSelection();
	const i18n = setupI18n({ locale, messages: { [locale]: copy[locale] } });
	const [page, setPage] = useState(1);
	const [pages, setPages] = useState(1);
	const [items, setItems] = useState<Notification[]>([]);
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	const [created, setCreated] = useState(false);
	const load = useCallback(async () => {
		if (!selectedProject) return;
		const result = await POST(`/api/v1/projects/${selectedProject.id}/notifications/search`, {
			page,
			per_page: 20,
			send_push: true,
		});
		setItems(result.data.data);
		setPages(result.data.total_pages);
	}, [selectedProject, page]);
	useEffect(() => {
		setPage(1);
		setCreated(false);
	}, [selectedProject?.id]);
	useEffect(() => {
		void load().catch(() => setError(true));
	}, [load]);
	return (
		<section className="space-y-5">
			<h1 className="text-xl font-semibold">{i18n._("title")}</h1>
			{error && <p role="alert">{i18n._("failed")}</p>}
			{created && <p role="status">{i18n._("created")}</p>}
			<form
				className="grid max-w-xl gap-3"
				onSubmit={async (event) => {
					event.preventDefault();
					if (!selectedProject || busy) return;
					setBusy(true);
					setError(false);
					setCreated(false);
					try {
						await POST(`/api/v1/projects/${selectedProject.id}/notifications`, {
							project_id: selectedProject.id,
							title,
							subtitle: body,
							send_push: true,
							auto_display: false,
							new_users: false,
							existing_users: true,
							platforms: ["ios", "android"],
						});
						setTitle("");
						setBody("");
						setCreated(true);
						await load();
					} catch {
						setError(true);
					} finally {
						setBusy(false);
					}
				}}
			>
				<Input
					label={i18n._("notification_title")}
					value={title}
					required
					maxLength={200}
					onChange={(event) => setTitle(event.target.value)}
				/>
				<Input
					label={i18n._("body")}
					value={body}
					required
					maxLength={2000}
					onChange={(event) => setBody(event.target.value)}
				/>
				<Button type="submit" variant="primary" loading={busy}>
					{i18n._("create")}
				</Button>
			</form>
			{items.length ? (
				<ul className="divide-y divide-kumo-line">
					{items.map((item) => (
						<li key={item.id} className="py-3">
							<strong>{item.title}</strong>
							<p>{item.subtitle}</p>
						</li>
					))}
				</ul>
			) : (
				<p>{i18n._("empty")}</p>
			)}
			<div className="flex gap-2">
				<Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
					{i18n._("previous")}
				</Button>
				<Button disabled={page >= pages} onClick={() => setPage(page + 1)}>
					{i18n._("next")}
				</Button>
			</div>
		</section>
	);
}
