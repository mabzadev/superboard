import { Button, Loader } from "@superboard/front-ui/kumo";
import { useEffect, useState } from "react";

import { useStudioI18n } from "./i18n.js";
import { getStudioDeliveries, getStudioDelivery, type StudioDelivery } from "./service.js";

export function EmailItemDeliveries({
	project,
	templateId,
}: {
	project: string;
	templateId: string;
}) {
	const { t } = useStudioI18n();
	const [items, setItems] = useState<StudioDelivery[]>([]);
	const [cursor, setCursor] = useState<string>();
	const [selected, setSelected] = useState<StudioDelivery>();
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => {
		let active = true;
		void getStudioDeliveries(project, { template_id: templateId }).then(
			(page) => {
				if (!active) return;
				setItems(page.items);
				setCursor(page.nextCursor);
				setLoading(false);
			},
			() => {
				if (active) {
					setError(t("Loading failed"));
					setLoading(false);
				}
			},
		);
		return () => {
			active = false;
		};
	}, [project, templateId, t]);
	const run = async (action: () => Promise<void>) => {
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			await action();
		} catch {
			setError(t("Loading failed"));
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className="space-y-4">
			<h2 className="text-xl font-semibold">{t("Delivery history")}</h2>
			{error && <p role="alert">{error}</p>}
			{loading ? (
				<Loader />
			) : (
				<div className="divide-y divide-kumo-line rounded-lg border border-kumo-line">
					{items.map((item) => (
						<div
							key={item.delivery_id}
							className="flex flex-wrap items-center justify-between gap-3 p-4"
						>
							<div>
								<p>{item.recipient_email}</p>
								<p className="text-sm text-kumo-subtle">
									{item.subject} · {item.locale}
								</p>
							</div>
							<p>{t(item.status)}</p>
							<Button
								disabled={busy}
								onClick={() =>
									void run(async () => {
										setSelected(await getStudioDelivery(project, item.delivery_id));
									})
								}
							>
								{t("View message")}
							</Button>
						</div>
					))}
					{!items.length && <p className="p-5 text-kumo-subtle">{t("No deliveries yet")}</p>}
				</div>
			)}
			{cursor && (
				<Button
					loading={busy}
					onClick={() =>
						void run(async () => {
							const page = await getStudioDeliveries(project, { template_id: templateId, cursor });
							setItems((values) => [...values, ...page.items]);
							setCursor(page.nextCursor);
						})
					}
				>
					{t("Load more")}
				</Button>
			)}
			{selected && (
				<div className="space-y-3 rounded-lg border border-kumo-line p-5">
					<p>
						{selected.subject} · {t(selected.status)}
					</p>
					{selected.last_error && <p>{selected.last_error}</p>}
					{selected.content_html ? (
						<iframe
							title={t("View message")}
							sandbox=""
							srcDoc={selected.content_html}
							className="h-96 w-full border-0"
						/>
					) : (
						<p>{t("Message body unavailable")}</p>
					)}
					<Button
						onClick={() => {
							setSelected(undefined);
						}}
					>
						{t("Close")}
					</Button>
				</div>
			)}
		</section>
	);
}
