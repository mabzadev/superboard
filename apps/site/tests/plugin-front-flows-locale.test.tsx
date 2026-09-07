import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { useFlowI18n } from "../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plugmod-flows/source/features/flows/i18n.js";

const context = vi.hoisted(() => ({ locale: "en" }));
vi.mock("@superboard/front-ui/context", () => ({ useFrontContext: () => context }));

function Labels() {
	const { t, tr } = useFlowI18n();
	return (
		<p>
			{t("editor")} · {tr("Project identifier")}
		</p>
	);
}

test.each([
	["en", "Editor · Project identifier"],
	["fr", "Éditeur · Identifiant du projet"],
])("Flows renders the Front locale %s before browser effects", (locale, labels) => {
	context.locale = locale;
	expect(renderToStaticMarkup(<Labels />)).toContain(labels);
});
