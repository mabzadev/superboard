import { Button, Input, Select } from "@superboard/front-ui/kumo";
import {
	Table as FrontTable,
	TableHeader as FrontTableHeader,
	TableBody as FrontTableBody,
	TableRow as FrontTableRow,
	TableHead as FrontTableHead,
	TableCell as FrontTableCell,
} from "@superboard/front-ui/ui/table.js";
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
			<div className="overflow-auto rounded-lg border border-kumo-line">
				<FrontTable className="w-full text-start text-sm">
					<FrontTableHeader className="bg-kumo-tint">
						<FrontTableRow>
							{["Subject", "Recipient", "Status", "Date"].map((key) => (
								<FrontTableHead key={key} className="p-3 text-start">
									{t(key)}
								</FrontTableHead>
							))}
						</FrontTableRow>
					</FrontTableHeader>
					<FrontTableBody>
						{items.map((item) => (
							<FrontTableRow key={item.id} className="border-t border-kumo-line">
								<FrontTableCell className="p-2">
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
								</FrontTableCell>
								<FrontTableCell>{item.recipients}</FrontTableCell>
								<FrontTableCell>{t(item.status)}</FrontTableCell>
								<FrontTableCell>{new Date(item.created_at).toLocaleString(locale)}</FrontTableCell>
							</FrontTableRow>
						))}
					</FrontTableBody>
				</FrontTable>
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
				<div className="space-y-4 rounded-lg border border-kumo-line p-5">
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
