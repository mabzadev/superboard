class TestResizeObserver implements ResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
	configurable: true,
	value: TestResizeObserver,
});

Object.defineProperty(window, "matchMedia", {
	configurable: true,
	value: (media: string): MediaQueryList => ({
		matches: false,
		media,
		onchange: null,
		addListener() {},
		removeListener() {},
		addEventListener() {},
		removeEventListener() {},
		dispatchEvent() {
			return true;
		},
	}),
});
