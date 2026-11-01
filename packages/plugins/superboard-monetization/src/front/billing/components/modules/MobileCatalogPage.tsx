import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { ModulePage, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { useSearchParams } from "@superboard/front-ui/navigation";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Checkbox } from "@superboard/front-ui/ui/checkbox.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superboard/front-ui/ui/dialog.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { useEffect, useState } from "react";

import { useMonetizationI18n } from "../../../i18n.js";
import * as api from "../../api/billing/billingService.js";

type Section = "products" | "offerings" | "entitlements";
type Draft = {
	kind: Section | "package";
	id?: string;
	offeringId: string;
	identifier: string;
	display_name: string;
	store: string;
	product_type: string;
	placement: string;
	is_current: boolean;
	active: boolean;
	package_type: string;
	position: number;
	product_ids: string[];
};
const initial = (kind: Draft["kind"], offeringId = ""): Draft => ({
	kind,
	offeringId,
	identifier: "",
	display_name: "",
	store: "apple",
	product_type: "subscription",
	placement: "default",
	is_current: false,
	active: true,
	package_type: "monthly",
	position: 0,
	product_ids: [],
});
const titles = { products: "Products", offerings: "Offerings", entitlements: "Entitlements" };
const sections: Section[] = ["products", "offerings", "entitlements"];

/** Products, Offerings and Entitlements are tabs of one Catalog page kept in `?tab=`; the
 * former /monetization/offerings and /monetization/entitlements routes open their tab. */
function CatalogTabs({ section }: { section: Section }) {
	const { t, locale } = useMonetizationI18n();
	return (
		<nav
			aria-label={t("Catalog")}
			className="bg-muted text-muted-foreground flex w-fit flex-wrap items-center gap-1 rounded-lg p-[3px]"
		>
			{sections.map((tab) => (
				<a
					key={tab}
					href={`/monetization/products?${tab === "products" ? "" : `tab=${tab}&`}lang=${locale}`}
					aria-current={tab === section ? "page" : undefined}
					className="text-foreground rounded-md px-3 py-1 text-sm font-medium aria-[current=page]:bg-background aria-[current=page]:shadow-sm"
				>
					{t(titles[tab])}
				</a>
			))}
		</nav>
	);
}

export default function MobileCatalogPage({ section: routeSection }: { section: Section }) {
	const requested = useSearchParams().get("tab");
	const section = sections.find((tab) => tab === requested) ?? routeSection;
	const { selectedProject } = useProjectSelection();
	const { t } = useMonetizationI18n();
	if (!selectedProject)
		return (
			<ModulePage
				title={t("Catalog")}
				description={t("Configure the products, offers and access used by your mobile app.")}
			>
				<CatalogTabs section={section} />
				<p role="status">{t("Loading settings…")}</p>
			</ModulePage>
		);
	return (
		<Catalog
			key={`${selectedProject.id}:${section}`}
			projectId={selectedProject.id}
			section={section}
		/>
	);
}

function Catalog({ projectId, section }: { projectId: string; section: Section }) {
	const { t } = useMonetizationI18n();
	const [data, setData] = useState<api.BillingOverview | null>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		let active = true;
		api
			.getBillingOverview(projectId)
			.then((value) => {
				if (active) {
					setData(value);
					setError(null);
				}
			})
			.catch((cause: unknown) => {
				if (active) setError(moduleErrorMessage(cause));
			});
		return () => {
			active = false;
		};
	}, [projectId, attempt]);
	async function run(action: () => Promise<unknown>) {
		setBusy(true);
		setError(null);
		try {
			await action();
			setDraft(null);
			setData(await api.getBillingOverview(projectId));
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		} finally {
			setBusy(false);
		}
	}
	function execute(action: () => Promise<unknown>) {
		run(action).catch((cause: unknown) => {
			setError(moduleErrorMessage(cause));
		});
	}

	function save(value: Draft) {
		return run(async () => {
			if (value.kind === "products") {
				if (value.id)
					return api.updateBillingProduct(projectId, value.id, {
						display_name: value.display_name,
						active: value.active,
					});
				return api.createProduct(projectId, {
					store: value.store,
					store_product_id: value.identifier,
					product_type: value.product_type,
					display_name: value.display_name,
				});
			}
			if (value.kind === "offerings") {
				const input = {
					identifier: value.identifier,
					display_name: value.display_name,
					placement: value.placement,
					is_current: value.is_current,
					active: value.active,
				};
				return value.id
					? api.updateBillingOffering(projectId, value.id, input)
					: api.createOffering(projectId, input);
			}
			if (value.kind === "entitlements") {
				const input = {
					identifier: value.identifier,
					display_name: value.display_name,
					product_ids: value.product_ids,
					active: value.active,
				};
				return value.id
					? api.updateBillingEntitlement(projectId, value.id, input)
					: api.createEntitlement(projectId, input);
			}
			const input = {
				identifier: value.identifier,
				package_type: value.package_type,
				position: value.position,
				product_ids: value.product_ids,
			};
			return value.id
				? api.updateBillingPackage(projectId, value.offeringId, value.id, input)
				: api.createBillingPackage(projectId, value.offeringId, input);
		});
	}
	const names = (ids: string[]) =>
		ids
			.map((id) => data?.products.find((product) => product.id === id)?.display_name || id)
			.join(", ");
	const linkedProducts = (id: string) =>
		data?.product_entitlements
			.filter((link) => link.entitlement_id === id)
			.map((link) => link.product_id) ?? [];
	return (
		<ModulePage
			title={t("Catalog")}
			description={t("Configure the products, offers and access used by your mobile app.")}
			error={null}
		>
			<CatalogTabs section={section} />
			{error && (
				<div role="alert" className="space-y-2">
					<p>{error}</p>
					<Button
						disabled={busy}
						onClick={() => {
							setAttempt((value) => value + 1);
						}}
					>
						{t("Retry")}
					</Button>
				</div>
			)}
			{!data ? (
				<p role="status">{t("Loading settings…")}</p>
			) : (
				<>
					<div className="flex flex-wrap items-center gap-3">
						<Button
							disabled={busy}
							onClick={() => {
								setDraft(initial(section));
							}}
						>
							{t(
								section === "products"
									? "New product"
									: section === "offerings"
										? "New offering"
										: "Add entitlement",
							)}
						</Button>
						{section === "products" && (
							<Button
								variant="outline"
								disabled={busy}
								onClick={() => {
									execute(async () => {
										const result = await api.syncBillingProducts(projectId);
										if (result.stores.some((store) => !store.ok))
											throw new Error(
												t("Some stores could not be synchronized. Check the store credentials."),
											);
									});
								}}
							>
								{t("Synchronize catalog")}
							</Button>
						)}
						{section === "products" && (
							<Button
								variant="outline"
								disabled={busy}
								onClick={() => {
									execute(() => api.syncStripeProducts(projectId));
								}}
							>
								{t("Synchronize Stripe prices")}
							</Button>
						)}
						<Button
							variant="outline"
							disabled={busy}
							onClick={() => {
								setAttempt((value) => value + 1);
							}}
						>
							{t("Refresh")}
						</Button>
					</div>
					{section === "products" && (
						<div className="grid gap-3">
							{!data.products.length && (
								<p>
									{t(
										"No mobile products configured. Add the exact product identifier from your store or synchronize the catalog.",
									)}
								</p>
							)}
							{data.products.map((product) => (
								<article
									key={product.id}
									className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
								>
									<div>
										<h2 className="font-semibold">{product.display_name}</h2>
										<code>{product.store_product_id}</code>
										<p>
											{t(
												product.store === "stripe"
													? "Stripe"
													: product.store === "apple"
														? "Apple App Store"
														: "Google Play Billing",
											)}{" "}
											· {t(product.environment === "sandbox" ? "Sandbox" : "Production")} ·{" "}
											{t(product.active ? "Active" : "Archived")}
										</p>
									</div>
									<Button
										variant="outline"
										disabled={busy}
										onClick={() => {
											setDraft({
												...initial("products"),
												id: product.id,
												identifier: product.store_product_id,
												display_name: product.display_name,
												store: product.store,
												product_type: product.product_type,
												active: Boolean(product.active),
											});
										}}
									>
										{t("Edit product")}
									</Button>
								</article>
							))}
						</div>
					)}
					{section === "entitlements" && (
						<div className="grid gap-3">
							{!data.entitlements.length && <p>{t("No entitlements configured.")}</p>}
							{data.entitlements.map((entitlement) => (
								<article
									key={entitlement.id}
									className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
								>
									<div>
										<h2 className="font-semibold">{entitlement.display_name}</h2>
										<code>{entitlement.identifier}</code>
										<p>{names(linkedProducts(entitlement.id)) || t("No products")}</p>
										<p>{t(entitlement.active ? "Active" : "Archived")}</p>
									</div>
									<Button
										variant="outline"
										disabled={busy}
										onClick={() => {
											setDraft({
												...initial("entitlements"),
												id: entitlement.id,
												identifier: entitlement.identifier,
												display_name: entitlement.display_name,
												active: Boolean(entitlement.active),
												product_ids: linkedProducts(entitlement.id),
											});
										}}
									>
										{t("Edit entitlement")}
									</Button>
								</article>
							))}
						</div>
					)}
					{section === "offerings" && (
						<div className="grid gap-4">
							{!data.offerings.length && <p>{t("No offerings configured.")}</p>}
							{data.offerings.map((offering) => {
								const packages = data.packages.filter((pkg) => pkg.offering_id === offering.id);
								return (
									<article key={offering.id} className="space-y-4 rounded-lg border p-4">
										<div className="flex flex-wrap items-center justify-between gap-3">
											<div>
												<h2 className="font-semibold">{offering.display_name}</h2>
												<code>{offering.identifier}</code>
												<p>
													{t("Placement")}: {offering.placement} ·{" "}
													{t(offering.is_current ? "Current offering" : "Alternative offering")} ·{" "}
													{t(offering.active ? "Active" : "Archived")}
												</p>
											</div>
											<Button
												variant="outline"
												disabled={busy}
												onClick={() => {
													setDraft({
														...initial("offerings"),
														id: offering.id,
														identifier: offering.identifier,
														display_name: offering.display_name,
														placement: offering.placement,
														is_current: Boolean(offering.is_current),
														active: Boolean(offering.active),
													});
												}}
											>
												{t("Edit offering")}
											</Button>
										</div>
										{!packages.length && (
											<p>{t("Add a package to make products available in this offering.")}</p>
										)}
										{packages.map((pkg) => (
											<div
												key={pkg.id}
												className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"
											>
												<div>
													<b>{pkg.identifier}</b>
													<p>{names(pkg.product_ids)}</p>
												</div>
												<div className="flex gap-2">
													<Button
														variant="outline"
														disabled={busy}
														onClick={() => {
															setDraft({
																...initial("package", offering.id),
																id: pkg.id,
																identifier: pkg.identifier,
																package_type: pkg.package_type,
																position: pkg.position,
																product_ids: pkg.product_ids,
															});
														}}
													>
														{t("Edit package")}
													</Button>
													<Button
														variant="outline"
														disabled={busy}
														onClick={() => {
															execute(() =>
																api.removeBillingPackage(projectId, offering.id, pkg.id),
															);
														}}
													>
														{t("Remove package")}
													</Button>
												</div>
											</div>
										))}
										<Button
											disabled={busy}
											onClick={() => {
												setDraft(initial("package", offering.id));
											}}
										>
											{t("Add package")}
										</Button>
									</article>
								);
							})}
						</div>
					)}
				</>
			)}
			<Dialog
				open={draft !== null}
				onOpenChange={(open) => {
					if (!open && !busy) {
						setDraft(null);
						setError(null);
					}
				}}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>
							{t(draft?.kind === "package" ? "Package" : titles[draft?.kind ?? section])}
						</DialogTitle>
						<DialogDescription>
							{t("Identifiers are stable public keys exposed to the SDK.")}
						</DialogDescription>
					</DialogHeader>
					{draft && (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								save(draft).catch((cause: unknown) => {
									setError(moduleErrorMessage(cause));
								});
							}}
							className="space-y-4"
						>
							<fieldset disabled={busy} className="space-y-4">
								<label className="grid gap-1">
									{t(draft.kind === "products" ? "Store product identifier" : "Identifier")}
									<Input
										required
										value={draft.identifier}
										disabled={Boolean(draft.id) && draft.kind !== "package"}
										onChange={(event) => {
											setDraft({ ...draft, identifier: event.target.value });
										}}
									/>
								</label>
								{draft.kind !== "package" && (
									<label className="grid gap-1">
										{t("Display name")}
										<Input
											required
											value={draft.display_name}
											onChange={(event) => {
												setDraft({ ...draft, display_name: event.target.value });
											}}
										/>
									</label>
								)}
								{draft.kind === "products" && (
									<>
										<label className="grid gap-1">
											{t("Store")}
											<select
												disabled={Boolean(draft.id)}
												value={draft.store}
												onChange={(event) => {
													setDraft({ ...draft, store: event.target.value });
												}}
												className="rounded border p-2"
											>
												<option value="apple">{t("Apple App Store")}</option>
												<option value="google">{t("Google Play Billing")}</option>
												<option value="stripe">{t("Stripe")}</option>
											</select>
										</label>
										<label className="grid gap-1">
											{t("Product type")}
											<select
												disabled={Boolean(draft.id)}
												value={draft.product_type}
												onChange={(event) => {
													setDraft({ ...draft, product_type: event.target.value });
												}}
												className="rounded border p-2"
											>
												<option value="subscription">{t("Subscription")}</option>
												<option value="non_consumable">{t("Non-consumable")}</option>
												<option value="consumable">{t("Consumable")}</option>
											</select>
										</label>
									</>
								)}
								{draft.kind === "offerings" && (
									<>
										<label className="grid gap-1">
											{t("Placement")}
											<Input
												required
												value={draft.placement}
												onChange={(event) => {
													setDraft({ ...draft, placement: event.target.value });
												}}
											/>
										</label>
										<label className="flex items-center gap-2">
											<Checkbox
												checked={draft.is_current}
												onCheckedChange={(value) => {
													setDraft({ ...draft, is_current: value === true });
												}}
											/>
											{t("Current offering")}
										</label>
									</>
								)}
								{draft.kind === "package" && (
									<>
										<label className="grid gap-1">
											{t("Package duration")}
											<select
												value={draft.package_type}
												onChange={(event) => {
													setDraft({ ...draft, package_type: event.target.value });
												}}
												className="rounded border p-2"
											>
												{[
													"weekly",
													"monthly",
													"two_month",
													"three_month",
													"six_month",
													"annual",
													"lifetime",
													"custom",
												].map((value) => (
													<option key={value} value={value}>
														{t(value)}
													</option>
												))}
											</select>
										</label>
										<label className="grid gap-1">
											{t("Position")}
											<Input
												type="number"
												min={0}
												required
												value={draft.position}
												onChange={(event) => {
													setDraft({ ...draft, position: Number(event.target.value) });
												}}
											/>
										</label>
										<p>{t("Select one equivalent product per store.")}</p>
									</>
								)}
								{(draft.kind === "entitlements" || draft.kind === "package") && (
									<fieldset className="space-y-2">
										<legend>{t("Products")}</legend>
										{data?.products.map((product) => (
											<label key={product.id} className="flex items-center gap-2">
												<Checkbox
													checked={draft.product_ids.includes(product.id)}
													onCheckedChange={(checked) => {
														setDraft({
															...draft,
															product_ids:
																checked === true
																	? [...draft.product_ids, product.id]
																	: draft.product_ids.filter((id) => id !== product.id),
														});
													}}
												/>
												{product.display_name} ({product.store_product_id} ·{" "}
												{t(
													product.store === "stripe"
														? "Stripe"
														: product.store === "apple"
															? "Apple"
															: "Google",
												)}
												)
											</label>
										))}
									</fieldset>
								)}
								{draft.id && draft.kind !== "package" && (
									<label className="flex items-center gap-2">
										<Checkbox
											checked={draft.active}
											onCheckedChange={(checked) => {
												setDraft({ ...draft, active: checked === true });
											}}
										/>
										{t("Active")}
									</label>
								)}
							</fieldset>
							{error && <p role="alert">{error}</p>}
							<div className="flex justify-end gap-2">
								<Button
									type="button"
									variant="outline"
									disabled={busy}
									onClick={() => {
										setDraft(null);
										setError(null);
									}}
								>
									{t("Cancel")}
								</Button>
								<Button
									type="submit"
									disabled={busy || (draft.kind === "package" && !draft.product_ids.length)}
								>
									{t(busy ? "Saving…" : "Save changes")}
								</Button>
							</div>
						</form>
					)}
				</DialogContent>
			</Dialog>
		</ModulePage>
	);
}
