import { useEffect, useRef, useState } from "react";

export function useDraftAutosave<T, R>({
	resourceKey,
	value,
	enabled,
	save,
	onSaved,
}: {
	resourceKey: string;
	value: T;
	enabled: boolean;
	save: (value: T) => Promise<R>;
	onSaved: (result: R) => void;
}) {
	const signature = JSON.stringify(value);
	const input = useRef({ value, signature, save, onSaved });
	input.current = { value, signature, save, onSaved };
	const saved = useRef({ key: resourceKey, signature });
	const saving = useRef(false);
	const failed = useRef("");
	const [status, setStatus] = useState("Saved");
	const [settled, setSettled] = useState(0);
	useEffect(() => {
		if (saved.current.key !== resourceKey) {
			saved.current = { key: resourceKey, signature };
			failed.current = "";
			setStatus("Saved");
			return;
		}
		if (saving.current || signature === saved.current.signature || signature === failed.current)
			return;
		setStatus("Unsaved changes");
		if (!enabled) return;
		const timer = setTimeout(async () => {
			saving.current = true;
			setStatus("Saving");
			const request = input.current;
			try {
				const result = await request.save(structuredClone(request.value));
				if (saved.current.key !== resourceKey) return;
				saved.current.signature = request.signature;
				request.onSaved(result);
				setStatus(input.current.signature === request.signature ? "Saved" : "Unsaved changes");
			} catch {
				if (saved.current.key === resourceKey) {
					failed.current = request.signature;
					setStatus("Save failed");
				}
			} finally {
				saving.current = false;
				setSettled((value) => value + 1);
			}
		}, 5000);
		return () => clearTimeout(timer);
	}, [resourceKey, signature, enabled, settled]);
	return status;
}
