import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { Button, Checkbox, Input, InputArea, Loader, Select } from "@superboard/front-ui/kumo";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { GET, PATCH, POST } from "../transport.js";
import { useStudioI18n } from "./i18n.js";
import { InAppContentEditor } from "./InAppContentEditor.js";
import { useCommunicationItem } from "./ItemNavigation.js";

const messageSchema = z.object({
	id: z.string(),
	title: z.string(),
	subtitle: z.string(),
	html: z.string().nullable(),
	send_push: z.boolean(),
	auto_display: z.boolean(),
	draft: z.boolean(),
	archived: z.boolean(),
	target: z.object({
		platforms: z.array(z.string()),
		new_users: z.boolean(),
		existing_users: z.boolean(),
	}),
	statistics: z
		.object({
			recipients: z.number(),
			views: z.number(),
			push: z.object({ queued: z.number(), delivered: z.number(), failed: z.number() }),
		})
		.optional(),
});
const messagePageSchema = z.object({ data: z.array(messageSchema), total_pages: z.number() });
type Message = z.infer<typeof messageSchema>;

export default function InAppItemsPage() {
	const { selectedProject } = useProjectSelection();
	const { itemId } = useCommunicationItem();
	return selectedProject ? (
		<InAppItems key={`${selectedProject.id}:${itemId}`} project={selectedProject.id} />
	) : null;
}

function InAppItems({ project }: { project: string }) {
	const { t } = useStudioI18n();
	const { itemId, section, select } = useCommunicationItem();
	const path = `/api/v1/projects/${encodeURIComponent(project)}/notifications`;
	const [items, setItems] = useState<Message[]>([]);
	const [selected, setSelected] = useState<Message>();
	const [page, setPage] = useState(1);
	const [pages, setPages] = useState(1);
	const [archived, setArchived] = useState(false);
	const [visual, setVisual] = useState(false);
	const [adding, setAdding] = useState(false);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [saved, setSaved] = useState(false);
	const load = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			if (itemId)
				setSelected(messageSchema.parse((await GET(`${path}/${encodeURIComponent(itemId)}`)).data));
			else {
				const response = await POST(`${path}/search`, {
					page,
					per_page: 20,
					include_drafts: true,
					archived,
				});
				const result = messagePageSchema.parse(response.data);
				setItems(result.data);
				setPages(result.total_pages);
			}
		} catch {
			setError(t("Loading failed"));
		} finally {
			setLoading(false);
		}
	}, [path, itemId, page, archived, t]);
	useEffect(() => {
		let active = true;
		const request = itemId
			? GET(`${path}/${encodeURIComponent(itemId)}`)
			: POST(`${path}/search`, { page, per_page: 20, include_drafts: true, archived });
		void request.then(
			(response) => {
				if (!active) return;
				if (itemId) setSelected(messageSchema.parse(response.data));
				else {
					const result = messagePageSchema.parse(response.data);
					setItems(result.data);
					setPages(result.total_pages);
				}
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
	}, [path, itemId, page, archived, t]);
	const save = async () => {
		if (!selected) return;
		await PATCH(`${path}/${encodeURIComponent(selected.id)}`, {
			title: selected.title,
			subtitle: selected.subtitle,
			html: selected.html,
			send_push: selected.send_push,
			auto_display: selected.auto_display,
			platforms: selected.target.platforms,
			new_users: selected.target.new_users,
			existing_users: selected.target.existing_users,
		});
	};
	const run = (action: () => Promise<void>) => {
		if (busy) return;
		setBusy(true);
		setError("");
		setSaved(false);
		action()
			.then(() => {
				setBusy(false);
			})
			.catch(() => {
				setError(t("Save failed"));
				setBusy(false);
			});
	};
	return (
		<section className="ds-page space-y-5">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					{itemId && (
						<Button
							variant="ghost"
							onClick={() => {
								select("");
							}}
						>
							{t("Back to list")}
						</Button>
					)}
					<h1 className="ds-page-title">{selected?.title ?? t("In-app messages")}</h1>
					<p className="ds-page-description">
						{t(
							itemId
								? "Configure this message, its audience and its results."
								: "Add a normal message or push notification, then configure it.",
						)}
					</p>
				</div>
				{!itemId && (
					<Button
						variant="primary"
						onClick={() => {
							setAdding(true);
						}}
					>
						{t("Add message")}
					</Button>
				)}
			</header>
			{error && (
				<div role="alert">
					{error} <Button onClick={() => void load()}>{t("Retry")}</Button>
				</div>
			)}
			{saved && <p role="status">{t("Saved")}</p>}
			{loading ? (
				<Loader />
			) : itemId ? (
				selected && (
					<>
						<nav
							aria-label={t("Message settings")}
							className="flex gap-2 border-b border-kumo-line pb-3"
						>
							{["content", "statistics"].map((value) => (
								<Button
									key={value}
									variant={section === value ? "secondary" : "ghost"}
									aria-pressed={section === value}
									onClick={() => {
										select(itemId, value);
									}}
								>
									{t(value === "content" ? "Configuration" : "Statistics")}
								</Button>
							))}
						</nav>
						{section === "statistics" ? (
							<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
								{Object.entries({
									Recipients: selected.statistics?.recipients ?? 0,
									Views: selected.statistics?.views ?? 0,
									Queued: selected.statistics?.push.queued ?? 0,
									delivered: selected.statistics?.push.delivered ?? 0,
									failed: selected.statistics?.push.failed ?? 0,
								}).map(([label, value]) => (
									<div key={label} className="rounded-lg border border-kumo-line p-5">
										<p className="text-sm text-kumo-subtle">{t(label)}</p>
										<p className="mt-2 text-2xl font-semibold">{value}</p>
									</div>
								))}
							</div>
						) : (
							<form
								className="space-y-5"
								onSubmit={(event) => {
									event.preventDefault();
									run(async () => {
										await save();
										setSaved(true);
									});
								}}
							>
								<p className="text-sm text-kumo-subtle">
									{t(
										selected.draft
											? "Draft — this message has not been sent."
											: "Published messages keep their original content.",
									)}
								</p>
								<fieldset disabled={busy || !selected.draft} className="grid gap-5 lg:grid-cols-2">
									<div className="space-y-4">
										<Select
											label={t("Message type")}
											value={selected.send_push ? "push" : "normal"}
											items={{ normal: t("Normal message"), push: t("Push notification") }}
											onValueChange={(value) => {
												setSelected({ ...selected, send_push: value === "push" });
											}}
										/>
										<Input
											label={t("Title")}
											value={selected.title}
											required
											maxLength={200}
											onChange={(event) => {
												setSelected({ ...selected, title: event.target.value });
											}}
										/>
										<InputArea
											label={t("Subtitle")}
											value={selected.subtitle}
											required
											maxLength={2000}
											onChange={(event) => {
												setSelected({ ...selected, subtitle: event.target.value });
											}}
										/>
										<details>
											<summary>{t("HTML source")}</summary>
											<InputArea
												label={t("Message HTML")}
												value={selected.html ?? ""}
												onChange={(event) => {
													setSelected({ ...selected, html: event.target.value });
												}}
											/>
										</details>
									</div>
									<div className="space-y-5 rounded-lg border border-kumo-line p-5">
										<p className="font-medium">{t("Platforms")}</p>
										{(
											[
												["android", "Android"],
												["ios", "Apple (iOS)"],
											] as const
										).map(([platform, label]) => (
											<Checkbox
												key={platform}
												label={t(label)}
												checked={selected.target.platforms.includes(platform)}
												onCheckedChange={(checked) => {
													setSelected({
														...selected,
														target: {
															...selected.target,
															platforms: checked
																? [...selected.target.platforms, platform]
																: selected.target.platforms.filter((value) => value !== platform),
														},
													});
												}}
											/>
										))}
										<Select
											label={t("Targeting")}
											value={selected.target.new_users ? "new" : "existing"}
											items={{ new: t("New users"), existing: t("Existing users") }}
											onValueChange={(value) => {
												setSelected({
													...selected,
													target: {
														...selected.target,
														new_users: value === "new",
														existing_users: value === "existing",
													},
												});
											}}
										/>
										<Checkbox
											label={t("Auto display")}
											checked={selected.auto_display}
											onCheckedChange={(checked) => {
												setSelected({ ...selected, auto_display: checked === true });
											}}
										/>
										<p className="text-sm text-kumo-subtle">
											{t(
												selected.send_push
													? "Push delivery uses the Android or Apple configuration of your application."
													: "Normal messages appear inside the application.",
											)}
										</p>
									</div>
								</fieldset>
								{selected.draft && (
									<Button
										disabled={busy}
										onClick={() => {
											setVisual(!visual);
										}}
									>
										{t(visual ? "Close editor" : "Visual editor")}
									</Button>
								)}
								{visual && selected.draft && (
									<InAppContentEditor
										html={selected.html}
										onApply={(html) => {
											setSelected({ ...selected, html });
											setVisual(false);
										}}
									/>
								)}
								{selected.html && (
									<iframe
										title={t("Message Preview")}
										sandbox=""
										srcDoc={selected.html}
										className="h-96 w-full rounded-lg border border-kumo-line"
									/>
								)}
								{selected.draft && (
									<div className="flex gap-3">
										<Button type="submit" loading={busy}>
											{t("Save")}
										</Button>
										<Button
											variant="primary"
											disabled={
												busy ||
												!selected.title.trim() ||
												!selected.subtitle.trim() ||
												!selected.target.platforms.length
											}
											onClick={() => {
												run(async () => {
													await save();
													await POST(`${path}/${selected.id}/publish`, {});
													await load();
												});
											}}
										>
											{t("Publish Message")}
										</Button>
									</div>
								)}
							</form>
						)}
					</>
				)
			) : (
				<>
					{adding && (
						<form
							className="flex max-w-xl flex-wrap items-end gap-3 rounded-lg border border-kumo-line p-5"
							onSubmit={(event) => {
								event.preventDefault();
								run(async () => {
									const result = await POST(path, {
										title: name.trim(),
										draft: true,
										send_push: false,
										auto_display: false,
										existing_users: true,
										new_users: false,
										platforms: ["android", "ios"],
									});
									setAdding(false);
									setName("");
									select(messageSchema.parse(result.data).id);
								});
							}}
						>
							<Input
								label={t("Name")}
								value={name}
								onChange={(event) => {
									setName(event.target.value);
								}}
								required
								maxLength={200}
							/>
							<Button type="submit" variant="primary" loading={busy}>
								{t("Create")}
							</Button>
							<Button
								onClick={() => {
									setAdding(false);
								}}
							>
								{t("Cancel")}
							</Button>
						</form>
					)}
					<Select
						label={t("Status")}
						value={archived ? "archived" : "current"}
						items={{ current: t("Drafts and published"), archived: t("Archived") }}
						onValueChange={(value) => {
							setArchived(value === "archived");
							setPage(1);
						}}
					/>
					<div className="divide-y divide-kumo-line rounded-lg border border-kumo-line">
						{items.map((item) => (
							<article key={item.id} className="flex items-center justify-between gap-3 p-5">
								<Button
									variant="ghost"
									onClick={() => {
										select(item.id);
									}}
								>
									{item.title}
								</Button>
								<span className="text-sm text-kumo-subtle">
									{t(item.send_push ? "Push notification" : "Normal message")} ·{" "}
									{t(item.draft ? "draft" : item.archived ? "Archived" : "Published")}
								</span>
							</article>
						))}
						{!items.length && <p className="p-6 text-kumo-subtle">{t("No messages yet")}</p>}
					</div>
					{pages > 1 && (
						<div className="flex gap-2">
							<Button
								disabled={page <= 1}
								onClick={() => {
									setPage(page - 1);
								}}
							>
								{t("Previous")}
							</Button>
							<Button
								disabled={page >= pages}
								onClick={() => {
									setPage(page + 1);
								}}
							>
								{t("Next")}
							</Button>
						</div>
					)}
				</>
			)}
		</section>
	);
}
