import { Signal } from "@preact/signals-core";
import { useEffect, useState } from "react";

const useSignalValue = <T>(signal: Signal<T>): T => {
	const [value, setValue] = useState<T>(signal.value);

	useEffect(() => {
		const unsubscribe = signal.subscribe((newValue) => {
			setValue(newValue);
		});

		return () => {
			unsubscribe();
		};
	}, [signal]);

	return value;
};

export default useSignalValue;
