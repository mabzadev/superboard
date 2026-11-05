import { usePathname, useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { useEffect, useState } from "react";

import { CollectionsView } from "./CollectionsView.js";
import { DocumentsView } from "./DocumentsView.js";
import { TaxonomiesView } from "./TaxonomiesView.js";
import { useDataI18n, useResource, type Collection, type Page } from "./workspace.js";

const tabs = ["documents", "trash", "collections", "taxonomies"] as const;
function requestedTab() {
	if (typeof window === "undefined") return "documents";
	const value = new URLSearchParams(window.location.search).get("tab");
	return tabs.find((tab) => tab === value) ?? "documents";
}
export default function ContentPage() {
	const { t } = useDataI18n();
	const router = useRouter();
	const pathname = usePathname();
	const search = useSearchParams();
	const [tab, setTab] = useState<string>(requestedTab);
	const collections = useResource<Page<Collection>>("/_emdash/api/schema/collections");
	const rows = collections.data?.items.filter((item) => item.slug !== "views") ?? [];
	const requested = search.get("collection");
	const collection = rows.find((item) => item.slug === requested)?.slug ?? rows[0]?.slug ?? "";
	useEffect(() => {
		const update = () => {
			setTab(requestedTab());
		};
		window.addEventListener("popstate", update);
		return () => {
			window.removeEventListener("popstate", update);
		};
	}, []);
	function changeTab(value: string) {
		setTab(value);
		const url = new URL(window.location.href);
		url.searchParams.set("tab", value);
		url.searchParams.delete("document");
		window.history.pushState(null, "", url);
	}
	function chooseCollection(value: string) {
		const next = new URLSearchParams(search);
		next.set("collection", value);
		next.delete("document");
		router.replace(`${pathname}?${next}`);
	}
	return (
		<section className="ds-page space-y-5">
			<header className="ds-page-header">
				<h1 className="ds-page-title">{t.title}</h1>
			</header>
			{collections.error && (
				<div role="alert">
					{collections.error}
					<Button onClick={collections.refresh}>{t.retry}</Button>
				</div>
			)}
			<Tabs value={tab} onValueChange={changeTab}>
				<TabsList aria-label={t.title}>
					{tabs.map((value) => (
						<TabsTrigger key={value} value={value}>
							{t[value]}
						</TabsTrigger>
					))}
				</TabsList>
				<TabsContent value="collections">
					<CollectionsView
						collections={rows}
						collection={collection}
						onSelect={chooseCollection}
						onChanged={collections.refresh}
					/>
				</TabsContent>
				<TabsContent value="taxonomies">
					<TaxonomiesView collections={rows} />
				</TabsContent>
				{["documents", "trash"].map((value) => (
					<TabsContent key={value} value={value}>
						{!collections.data ? (
							<p role="status">{t.loading}</p>
						) : !collection ? (
							<div className="space-y-3">
								<p>{t.noCollections}</p>
								<Button
									onClick={() => {
										changeTab("collections");
									}}
								>
									{t.createCollection}
								</Button>
							</div>
						) : (
							<DocumentsView
								key={`${collection}:${value}`}
								collections={rows}
								collection={collection}
								onCollectionChange={chooseCollection}
								trash={value === "trash"}
							/>
						)}
					</TabsContent>
				))}
			</Tabs>
		</section>
	);
}
