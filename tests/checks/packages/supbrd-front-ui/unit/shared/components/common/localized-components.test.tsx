import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
	FrontContextProvider,
	type FrontContextValue,
} from "../../../../../../../../packages/supbrd-front-ui/src/context.js";
import AdsPlatformSelect from "../../../../../../../../packages/supbrd-front-ui/src/shared/components/common/ads-platform.js";
import DataTable from "../../../../../../../../packages/supbrd-front-ui/src/shared/components/common/DataTable.js";
import DeleteConfirm from "../../../../../../../../packages/supbrd-front-ui/src/shared/components/common/delete-confirm.js";
import { DateRangePicker } from "../../../../../../../../packages/supbrd-front-ui/src/shared/components/dateRangePicker/DateRangePicker.js";
import {
	adsFilterList,
	platformsFilterList,
} from "../../../../../../../../packages/supbrd-front-ui/src/shared/constants/FilterOptions.js";

function renderIn(locale: "en" | "fr", ui: ReactNode) {
	const context: FrontContextValue = {
		instanceId: "1",
		pluginId: "superboard-acquisition",
		path: "/",
		parameters: {},
		locale,
		operator: null,
		projectScope: null,
		activePluginIds: [],
	};
	return render(<FrontContextProvider value={context}>{ui}</FrontContextProvider>);
}

const noop = () => undefined;

describe("shared Front components in French", () => {
	it("explains an empty search result in the table", () => {
		renderIn(
			"fr",
			<DataTable
				columns={[{ accessorKey: "name", header: "Nom" }]}
				data={[]}
				selectedColumns={["name"]}
				hasFilters
				emptyState={null}
				ariaLabel="Liens"
			/>,
		);
		const table = screen.getByRole("table", { name: "Liens" });
		expect(within(table).getByText("Aucun résultat")).toBeInTheDocument();
		expect(within(table).getByText("Modifiez votre recherche ou vos filtres")).toBeInTheDocument();
		expect(within(table).queryByText("No results found")).not.toBeInTheDocument();
	});

	it("names the platform and link type filters and their choices", () => {
		renderIn(
			"fr",
			<>
				<AdsPlatformSelect
					platformAdsOptions={platformsFilterList}
					selectedAdsPlatform=""
					setSelectedAdsPlatforms={noop}
				/>
				<AdsPlatformSelect
					platformAdsOptions={adsFilterList}
					selectedAdsPlatform="quick-link"
					setSelectedAdsPlatforms={noop}
				/>
			</>,
		);
		const platforms = screen.getByRole("combobox", { name: "Plateformes" });
		expect(screen.getByRole("combobox", { name: "Liens rapides" })).toBeInTheDocument();
		fireEvent.click(platforms);
		const choices = screen.getByRole("dialog");
		expect(within(choices).getByText("Toutes")).toBeInTheDocument();
		expect(within(choices).getByText("Android")).toBeInTheDocument();
		expect(within(choices).queryByText("All")).not.toBeInTheDocument();
	});

	it("confirms a deletion with French defaults", () => {
		renderIn(
			"fr",
			<DeleteConfirm onConfirm={noop}>
				<button type="button">Supprimer le membre</button>
			</DeleteConfirm>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Supprimer le membre" }));
		const dialog = screen.getByRole("dialog", { name: "Voulez-vous vraiment continuer ?" });
		expect(dialog).toHaveAccessibleDescription(
			"Cette action est irréversible. L’élément sera définitivement supprimé.",
		);
		expect(within(dialog).getByRole("button", { name: "Annuler" })).toBeInTheDocument();
		expect(within(dialog).getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
		expect(within(dialog).getByRole("button", { name: "Fermer" })).toBeInTheDocument();
	});

	it("shows dates, presets and the calendar in French", () => {
		const range = { from: new Date(2026, 9, 5), to: new Date(2026, 10, 4) };
		renderIn("fr", <DateRangePicker date={range} setDate={noop} />);
		const trigger = screen.getByRole("button", { name: "5 oct. 2026 - 4 nov. 2026" });
		fireEvent.click(trigger);
		const picker = screen.getByRole("dialog");
		expect(within(picker).getByRole("button", { name: "Aujourd’hui" })).toBeInTheDocument();
		expect(within(picker).getByRole("button", { name: "3 derniers mois" })).toBeInTheDocument();
		expect(within(picker).getByRole("grid", { name: "octobre 2026" })).toBeInTheDocument();
		expect(
			within(picker).getByRole("button", { name: "Aller au mois suivant" }),
		).toBeInTheDocument();
	});

	it("keeps the English wording for English pages", () => {
		renderIn("en", <DateRangePicker date={undefined} setDate={noop} />);
		expect(screen.getByRole("button", { name: "Pick a date range" })).toBeInTheDocument();
	});
});
