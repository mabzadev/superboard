export function summarizePublishedMenu({
	origin,
	discovered,
	pages,
	faults,
	actions = [],
	action_faults = [],
	errors,
}) {
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
	const failedActions = actions.filter((action) => !action.success).length;
	const unexpectedActionFaults = action_faults.filter((fault) => {
		const succeeded = Boolean(fault.result?.success);
		return (fault.expected === "passed") !== succeeded;
	}).length;
	return {
		planned: planned.size,
		executed: pages.length,
		passed: pages.length - failed,
		failed,
		unverified,
		expected_faults: faults.length - unexpectedFaults,
		unexpected_faults: unexpectedFaults,
		actions: { executed: actions.length, failed: failedActions },
		expected_action_faults: action_faults.length - unexpectedActionFaults,
		unexpected_action_faults: unexpectedActionFaults,
		complete:
			planned.size > 0 &&
			executed.size === pages.length &&
			unverified.length === 0 &&
			failed === 0 &&
			unexpectedFaults === 0 &&
			failedActions === 0 &&
			unexpectedActionFaults === 0 &&
			errors.length === 0,
	};
}
