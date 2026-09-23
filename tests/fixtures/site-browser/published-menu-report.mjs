export function summarizePublishedMenu({ origin, discovered, pages, faults, errors }) {
	const key = (href, locale) => {
		const url = new URL(href, origin);
		url.searchParams.delete("lang");
		url.searchParams.sort();
		return `${locale}:${url.pathname}${url.search}`;
	};
	const planned = new Map(discovered.map((link) => [key(link.href, link.locale), link]));
	const executed = new Set(pages.map((page) => key(page.url, page.locale)));
	const unverified = [...planned].filter(([id]) => !executed.has(id)).map(([, link]) => link);
	const failed = pages.filter((page) => page.status !== "passed" || page.errors.length > 0).length;
	const unexpectedFaults = faults.filter((fault) => fault.expected !== fault.result.status).length;
	return {
		planned: planned.size,
		executed: pages.length,
		passed: pages.length - failed,
		failed,
		unverified,
		expected_faults: faults.length - unexpectedFaults,
		unexpected_faults: unexpectedFaults,
		complete:
			planned.size > 0 &&
			executed.size === pages.length &&
			unverified.length === 0 &&
			failed === 0 &&
			unexpectedFaults === 0 &&
			errors.length === 0,
	};
}
