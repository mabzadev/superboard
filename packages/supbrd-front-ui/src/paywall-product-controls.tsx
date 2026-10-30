import { useEffect, useState } from "react";
import { z } from "zod";

import { Button, Checkbox, Select } from "./kumo.js";
import { useProjectSelection } from "./shared/context/useProjectSelection.js";
import { createPluginApiClient } from "./shared/lib/api.js";
import { config } from "./shared/lib/config.js";

const catalogApi = createPluginApiClient("superboard-products");
const packageSchema = z.object({
	id: z.string(),
	identifier: z.string(),
	display_name: z.string(),
});
const offeringSchema = z.object({
	identifier: z.string(),
	display_name: z.string(),
	package_ids: z.array(z.string()).default([]),
	packages: z.array(packageSchema).optional(),
});
const catalogSchema = z.object({
	offerings: z.array(offeringSchema),
	packages: z.array(packageSchema),
});
type Catalog = z.infer<typeof catalogSchema>;
function unwrap(value: unknown): unknown {
	return value && typeof value === "object" && "data" in value ? value.data : value;
}

export function PaywallProductControls({
	props,
	onChange,
	t,
}: {
	props: Record<string, unknown>;
	onChange: (props: Record<string, unknown>) => void;
	t: (key: string) => string;
}) {
	const { selectedProject } = useProjectSelection();
	const projectId = selectedProject?.id;
	const [result, setResult] = useState<{
		projectId: string;
		attempt: number;
		catalog: Catalog | null;
		error: boolean;
	} | null>(null);
	const [attempt, setAttempt] = useState(0);
	const catalog =
		result && result.projectId === projectId && result.attempt === attempt ? result.catalog : null;
	const error =
		result && result.projectId === projectId && result.attempt === attempt && result.error;
	useEffect(() => {
		let active = true;
		if (!projectId) return;
		const root = `${config.apiPath}/products/projects/${encodeURIComponent(projectId)}`;
		void Promise.all([catalogApi.GET(`${root}/offerings`), catalogApi.GET(`${root}/packages`)])
			.then(([offerings, packages]) => {
				const data = catalogSchema.parse({
					offerings: unwrap(offerings.data),
					packages: unwrap(packages.data),
				});
				if (active) setResult({ projectId, attempt, catalog: data, error: false });
			})
			.catch(() => {
				if (active) setResult({ projectId, attempt, catalog: null, error: true });
			});
		return () => {
			active = false;
		};
	}, [projectId, attempt]);
	const offering =
		typeof props.offering_identifier === "string" ? props.offering_identifier : "default";
	const current = catalog?.offerings.find((item) => item.identifier === offering);
	const availablePackages =
		current?.packages ??
		catalog?.packages.filter((item) => current?.package_ids.includes(item.id)) ??
		[];
	const selected = Array.isArray(props.package_identifiers)
		? props.package_identifiers.filter((item): item is string => typeof item === "string")
		: [];
	const choices: Record<string, string> = { [offering]: offering };
	for (const item of catalog?.offerings ?? []) choices[item.identifier] = item.display_name;
	return (
		<>
			<Select
				label={t("Offering identifier")}
				value={offering}
				items={choices}
				onValueChange={(value) => {
					if (value) onChange({ offering_identifier: value, package_identifiers: [] });
				}}
			/>
			{error ? (
				<div role="alert" className="space-y-2 text-sm text-kumo-danger">
					<p>{t("Catalog unavailable")}</p>
					<Button
						size="sm"
						onClick={() => {
							setAttempt((value) => value + 1);
						}}
					>
						{t("Retry")}
					</Button>
				</div>
			) : catalog?.offerings.length === 0 ? (
				<p className="text-sm text-kumo-subtle">{t("No offerings available")}</p>
			) : null}
			<fieldset className="space-y-2">
				<legend className="mb-2 text-sm">{t("Package identifiers")}</legend>
				<Checkbox
					label={t("All packages")}
					checked={selected.length === 0}
					disabled={!availablePackages.length && !selected.length}
					onCheckedChange={(checked) => {
						onChange({
							package_identifiers: checked ? [] : availablePackages.map((item) => item.identifier),
						});
					}}
				/>
				{[...new Set([...availablePackages.map((item) => item.identifier), ...selected])].map(
					(identifier) => (
						<Checkbox
							key={identifier}
							label={
								availablePackages.find((item) => item.identifier === identifier)?.display_name ??
								identifier
							}
							checked={selected.includes(identifier)}
							onCheckedChange={(checked) => {
								onChange({
									package_identifiers: checked
										? [...selected, identifier]
										: selected.filter((item) => item !== identifier),
								});
							}}
						/>
					),
				)}
				{catalog && !availablePackages.length && !selected.length && (
					<p className="text-sm text-kumo-subtle">{t("No packages available")}</p>
				)}
			</fieldset>
			<Select
				label={t("Product layout")}
				value={props.style === "list" ? "list" : "cards"}
				items={{ cards: t("Cards"), list: t("List") }}
				onValueChange={(value) => {
					if (value) onChange({ style: value });
				}}
			/>
		</>
	);
}
