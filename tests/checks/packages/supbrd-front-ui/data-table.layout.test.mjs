import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { build } from "esbuild";

const packageRoot = fileURLToPath(
	new URL("../../../../packages/supbrd-front-ui/", import.meta.url),
);
const requireFromPackage = createRequire(path.join(packageRoot, "package.json"));
const { compile } = requireFromPackage("tailwindcss");
const sources = [
	"src/shared/components/common/DataTable.tsx",
	"src/shared/components/ui/table.tsx",
	"src/shared/components/ui/skeleton.tsx",
];

const fixture = `
import { createRoot } from "react-dom/client";
import DataTable from "./src/shared/components/common/DataTable.tsx";

const columns = Array.from({ length: 12 }, (_, index) => ({
	accessorKey: "column" + index,
	header: "Column header number " + index,
}));
const selected = columns.map((column) => column.accessorKey);
const plain = (
	<div className="flex flex-col items-center py-14 text-center">
		<p>Nothing to show</p>
	</div>
);
const pinned = (
	<div className="sticky start-0 flex w-[100cqi] flex-col items-center justify-center px-4 py-14">
		<p>Nothing to show</p>
	</div>
);
const scrollingContainer =
	"@container relative min-h-0 overflow-auto overscroll-none rounded-md border [&>[data-slot=table-container]]:overflow-visible";

function Case({ name, dir = "ltr", ...props }) {
	return (
		<section data-case={name} dir={dir} style={{ width: 600, marginBottom: 24 }}>
			<DataTable columns={columns} data={[]} selectedColumns={selected} ariaLabel={name} {...props} />
		</section>
	);
}

createRoot(document.getElementById("root")).render(
	<>
		<Case name="default empty state" emptyState={plain} />
		<Case name="default no results" hasFilters emptyState={plain} />
		<Case name="right-to-left empty state" dir="rtl" emptyState={plain} />
		<Case name="pinned empty state in a scrolling container" stickyHeader containerClassName={scrollingContainer} emptyState={pinned} />
		<Case name="no results in a scrolling container" stickyHeader hasFilters containerClassName={scrollingContainer} emptyState={pinned} />
	</>,
);
`;

async function loadStylesheet(id, base) {
	const file = id.startsWith(".")
		? path.resolve(base, id)
		: requireFromPackage.resolve(`${id}/index.css`);
	return { path: file, base: path.dirname(file), content: await readFile(file, "utf8") };
}

async function stylesheet() {
	const compiler = await compile('@import "tailwindcss";', { base: packageRoot, loadStylesheet });
	const texts = await Promise.all(
		sources.map((source) => readFile(path.join(packageRoot, source), "utf8")),
	);
	const candidates = [fixture, ...texts].join("\n").split(/[\s"'`{}()]+/u);
	return compiler.build(candidates);
}

async function script() {
	const bundle = await build({
		stdin: { contents: fixture, loader: "tsx", resolveDir: packageRoot },
		bundle: true,
		format: "iife",
		platform: "browser",
		jsx: "automatic",
		write: false,
		logLevel: "error",
		define: { "process.env.NODE_ENV": '"production"' },
	});
	return bundle.outputFiles[0].text;
}

function measure() {
	return [...document.querySelectorAll("[data-case]")].map((section) => {
		const table = section.querySelector("table");
		let port = table.parentElement;
		while (port && getComputedStyle(port).overflowX === "visible") port = port.parentElement;
		const message = section.querySelector("tbody p");
		const centerOf = (rect) => rect.left + rect.width / 2;
		const portRect = port.getBoundingClientRect();
		const visibleCenter = portRect.left + port.clientLeft + port.clientWidth / 2;
		const offset = () => Math.abs(centerOf(message.getBoundingClientRect()) - visibleCenter);
		const style = getComputedStyle(port);
		const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
		const atStart = offset();
		port.scrollLeft = section.dir === "rtl" ? -port.scrollWidth : port.scrollWidth;
		return {
			name: section.dataset.case,
			overflow: table.getBoundingClientRect().width - port.clientWidth,
			scrolled: Math.abs(port.scrollLeft),
			scrollbar: port.offsetHeight - port.clientHeight - borders,
			atStart,
			atEnd: offset(),
		};
	});
}

test("table messages stay centred in the visible area and the horizontal scrollbar is shown", async (t) => {
	const [css, js] = await Promise.all([stylesheet(), script()]);
	const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 900, height: 2000 } });
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.setContent(
		`<!doctype html><html lang="en"><head><style>${css}</style></head><body><div id="root"></div></body></html>`,
	);
	await page.addScriptTag({ content: js });
	await page.waitForSelector("[data-case] tbody p");
	const results = await page.evaluate(measure);
	assert.deepEqual(errors, []);
	assert.equal(results.length, 5);
	for (const result of results) {
		assert.ok(result.overflow > 300, `${result.name}: the table is wider than its container`);
		assert.ok(result.scrolled > 300, `${result.name}: the table scrolls horizontally`);
		assert.ok(result.scrollbar > 0, `${result.name}: the horizontal scrollbar is rendered`);
		assert.ok(result.atStart < 2, `${result.name}: centred before scrolling (${result.atStart}px)`);
		assert.ok(result.atEnd < 2, `${result.name}: centred after scrolling (${result.atEnd}px)`);
	}
});
