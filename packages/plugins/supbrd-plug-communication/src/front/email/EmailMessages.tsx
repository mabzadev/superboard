import { Button, Input, Select } from "@superboard/front-ui/kumo";
import { useEffect, useState } from "react";

import { useStudioI18n } from "../marketing/studio/i18n.js";
import {
	getEmailMessage,
	getEmailMessages,
	type EmailMessageSummary,
	type EmailMessageDetail,
} from "./api/email/emailService.js";

export function EmailMessages({ project }: { project: string }) {
	const { t, locale } = useStudioI18n();
	const [items, setItems] = useState<EmailMessageSummary[]>([]);
	const [query, setQuery] = useState("");
	const [status, setStatus] = useState("");
	const [cursor, setCursor] = useState<string>();
	const [selected, setSelected] = useState<EmailMessageDetail>();
	const [error, setError] = useState("");
	useEffect(() => {
		let active = true;
		setError("");
		const timer = setTimeout(() => {
			void getEmailMessages(project, { q: query, status }).then(
				(result) => {
					if (active) {
						setItems(result.items);
						setCursor(result.nextCursor);
					}
				},
				() => {
					if (active) setError(t("Loading failed"));
				},
			);
		}, 250);
		return () => {
			active = false;
			clearTimeout(timer);
		};
	}, [project, query, status, t]);
	return (
		<section className="space-y-4">
			<div className="flex flex-wrap gap-3">
				<Input
					label={t("Search messages")}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
				<Select
					label={t("Status")}
					value={status}
					onValueChange={(value) => setStatus(value ?? "")}
					items={{
						"": t("All"),
						...Object.fromEntries(
							["captured", "queued", "sending", "sent", "failed"].map((key) => [key, t(key)]),
						),
					}}
				/>
			</div>
			{error && (
				<p role="alert" className="text-kumo-danger">
					{error}
				</p>
			)}
			<div className="overflow-auto rounded-xl border border-kumo-line">
				<table className="w-full text-start text-sm">
					<thead className="bg-kumo-tint">
						<tr>
							{["Subject", "Recipient", "Status", "Date"].map((key) => (
								<th key={key} className="p-3 text-start">
									{t(key)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{items.map((item) => (
							<tr key={item.id} className="border-t border-kumo-line">
								<td className="p-2">
									<Button
										variant="ghost"
										onClick={async () => {
											try {
												setSelected(await getEmailMessage(project, item.id));
											} catch {
												setError(t("Loading failed"));
											}
										}}
									>
										{item.subject}
									</Button>
								</td>
								<td>{item.recipients}</td>
								<td>{t(item.status)}</td>
								<td>{new Date(item.created_at).toLocaleString(locale)}</td>
							</tr>
						))}
					</tbody>
				</table>
				{!items.length && !error && (
					<p className="p-5 text-kumo-subtle">{t("No deliveries yet")}</p>
				)}
			</div>
			{cursor && (
				<Button
					onClick={async () => {
						try {
							const result = await getEmailMessages(project, { q: query, status, cursor });
							setItems((values) => [...values, ...result.items]);
							setCursor(result.nextCursor);
						} catch {
							setError(t("Loading failed"));
						}
					}}
				>
					{t("Load more")}
				</Button>
			)}
			{selected && (
				<div className="space-y-4 rounded-xl border border-kumo-line p-5">
					<div className="flex justify-between">
						<div>
							<h3 className="font-semibold">{selected.subject}</h3>
							<p className="mt-1 text-sm">
								{selected.from_name} · {selected.from_address} · {t(selected.status)}
							</p>
						</div>
						<Button variant="ghost" onClick={() => setSelected(undefined)}>
							{t("Close")}
						</Button>
					</div>
					{selected.last_error && <p role="alert">{selected.last_error}</p>}
					{selected.html_body ? (
						<iframe
							title={t("Email preview")}
							sandbox=""
							className="h-[600px] w-full border-0"
							srcDoc={selected.html_body}
						/>
					) : (
						<pre className="whitespace-pre-wrap">{selected.text_body}</pre>
					)}
					<div>
						{selected.deliveries.map((delivery) => (
							<p key={delivery.recipient} className="border-t border-kumo-line py-2 text-sm">
								{delivery.recipient} · {t(delivery.provider_status ?? delivery.status)} ·{" "}
								{delivery.attempt_count} {t("attempts")}
							</p>
						))}
					</div>
				</div>
			)}
		</section>
	);
}
