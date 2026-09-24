import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	EmptyProject,
	ModulePage,
	moduleErrorMessage,
} from "@superboard/front-ui/modules/ModulePage.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import { useEffect, useState, type ReactNode } from "react";

import {
	getSupportResource,
	type SupportCursorPage,
	type SupportCursorQuery,
} from "../../api/support/nativeClient.js";
import { useSupportI18n } from "../../i18n.js";
import {
	SupportError,
	SupportLoadMore,
	SupportLoading,
	useSupportCollection,
} from "./SupportUi.js";

export function supportEntityUrl(
	path: string,
	key: string,
	id: string,
	locale: string,
	tab = "settings",
) {
	const search = new URLSearchParams({ [key]: id, tab, lang: locale });
	const section =
		typeof window === "undefined"
			? null
			: new URLSearchParams(window.location.search).get("section");
	if (section) search.set("section", section);
	return `${path}?${search}`;
}

export function SupportEntityPage<T extends { id: string; name: string }>({
	title,
	resource,
	parameter,
	path,
	list,
	create,
	children,
	creationFields,
}: {
	title: string;
	creationFields?: ReactNode;
	resource: string;
	parameter: string;
	path: string;
	list: (project: string, query: SupportCursorQuery) => Promise<SupportCursorPage<T>>;
	create: (project: string, name: string) => Promise<{ data: T }>;
	children: (item: T, project: string, update: (item: T) => void) => ReactNode;
}) {
	const { t, locale } = useSupportI18n();
	const { selectedProject } = useProjectSelection();
	const project = selectedProject?.id;
	const id =
		typeof window === "undefined"
			? null
			: new URLSearchParams(window.location.search).get(parameter);
	const collection = useSupportCollection(id ? undefined : project, list);
	const [loaded, setLoaded] = useState<{ project: string; id: string; item: T } | null>(null);
	const item = loaded?.project === project && loaded?.id === id ? loaded.item : null;
	const [error, setError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [saving, setSaving] = useState(false);
	const [name, setName] = useState("");
	useEffect(() => {
		if (!project || !id) return;
		let active = true;
		void getSupportResource<T>(project, resource, id)
			.then((result) => {
				if (active) {
					setLoaded({ project, id, item: result.data });
					setError(null);
				}
			})
			.catch((cause: unknown) => {
				if (active) setError(moduleErrorMessage(cause));
			});
		return () => {
			active = false;
		};
	}, [project, id, resource]);
	const add = async () => {
		if (!project || !name.trim()) return;
		setSaving(true);
		try {
			const result = await create(project, name.trim());
			window.location.assign(supportEntityUrl(path, parameter, result.data.id, locale));
		} catch (cause) {
			setError(moduleErrorMessage(cause));
			setSaving(false);
		}
	};
	if (!project)
		return (
			<ModulePage title={t(title)} description={t("Create an item, then open it to configure it.")}>
				<EmptyProject />
			</ModulePage>
		);
	if (id)
		return (
			<section className="ds-page space-y-5">
				<a className="text-sm underline" href={`${path}?lang=${locale}`}>
					{t("Back to list")}
				</a>
				<header className="ds-page-header">
					<h1 className="ds-page-title">{item?.name ?? t(title)}</h1>
				</header>
				<SupportError message={error} />
				{item
					? children(item, project, (updated) => {
							setLoaded({ project, id, item: updated });
						})
					: !error && <SupportLoading />}
			</section>
		);
	return (
		<ModulePage
			title={t(title)}
			description={t("Create an item, then open it to configure it.")}
			error={error ?? collection.error}
		>
			<div className="flex justify-end">
				<Button
					onClick={() => {
						setCreating(true);
					}}
				>
					{t("Add an item")}
				</Button>
			</div>
			{creating && (
				<form
					className="space-y-4 rounded-md border p-5"
					onSubmit={(event) => {
						event.preventDefault();
						void add().catch((cause: unknown) => {
							setError(moduleErrorMessage(cause));
						});
					}}
				>
					<Label htmlFor={`${parameter}-name`}>{t("Name")}</Label>
					<Input
						id={`${parameter}-name`}
						value={name}
						onChange={(event) => {
							setName(event.target.value);
						}}
						required
					/>
					{creationFields}
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								setCreating(false);
							}}
						>
							{t("Cancel")}
						</Button>
						<Button type="submit" disabled={saving || !name.trim()}>
							{t("Create and configure")}
						</Button>
					</div>
				</form>
			)}
			{collection.loading ? (
				<SupportLoading />
			) : (
				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
					{collection.items.map((row) => (
						<a
							className="rounded-md border p-5 font-medium hover:bg-muted"
							key={row.id}
							href={supportEntityUrl(path, parameter, row.id, locale)}
						>
							{row.name}
						</a>
					))}
					{!collection.items.length && (
						<p className="text-sm text-muted-foreground">
							{t("Add your first item to get started.")}
						</p>
					)}
				</div>
			)}
			<SupportLoadMore
				visible={collection.hasMore}
				loading={collection.loadingMore}
				onClick={() => void collection.loadMore()}
			/>
		</ModulePage>
	);
}
