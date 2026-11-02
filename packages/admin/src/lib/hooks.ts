import * as React from "react";

export function useStableCallback<Args extends unknown[], Return>(
	callback: (...args: Args) => Return,
): (...args: Args) => Return {
	const ref = React.useRef(callback);
	React.useLayoutEffect(() => {
		ref.current = callback;
	});
	return React.useCallback((...args: Args) => ref.current(...args), []);
}

export function useDebouncedValue<T>(value: T, delay: number): T {
	const [debouncedValue, setDebouncedValue] = React.useState(value);
	React.useEffect(() => {
		const timer = setTimeout(setDebouncedValue, delay, value);
		return () => clearTimeout(timer);
	}, [value, delay]);
	return debouncedValue;
}
