import {
	AutosaveIndicator,
	useSettingsAutosave,
	type AutosaveStatus,
} from "@superboard/front-ui/settings-form";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useId,
	useState,
	type ReactNode,
} from "react";

type Entry = { status: AutosaveStatus; retry(): void };
type Report = (id: string, entry: Entry | null) => void;

const AutosaveContext = createContext<Report | null>(null);
const precedence: AutosaveStatus[] = ["error", "saving", "pending", "saved"];

export function AutosaveScope({ children }: { children: ReactNode }) {
	const [entries, setEntries] = useState<ReadonlyMap<string, Entry>>(new Map());
	const report = useCallback<Report>((id, entry) => {
		setEntries((previous) => {
			const current = previous.get(id);
			if (current?.status === entry?.status && current?.retry === entry?.retry) return previous;
			const next = new Map(previous);
			if (entry) next.set(id, entry);
			else next.delete(id);
			return next;
		});
	}, []);
	const list = [...entries.values()];
	const status =
		precedence.find((candidate) => list.some((entry) => entry.status === candidate)) ?? "idle";
	return (
		<AutosaveContext.Provider value={report}>
			{children}
			<AutosaveIndicator
				status={status}
				onRetry={() => {
					for (const entry of list) if (entry.status === "error") entry.retry();
				}}
			/>
		</AutosaveContext.Provider>
	);
}

export function useAutosave<T>(options: {
	resourceKey: string;
	value: T;
	save(value: T): Promise<void>;
	enabled?: boolean;
	delay?: number;
}) {
	const { status, retry } = useSettingsAutosave(options);
	const report = useContext(AutosaveContext);
	const id = useId();
	useEffect(() => {
		report?.(id, { status, retry });
	}, [report, id, status, retry]);
	useEffect(
		() => () => {
			report?.(id, null);
		},
		[report, id],
	);
	return {
		status,
		indicator: report ? null : <AutosaveIndicator status={status} onRetry={retry} />,
	};
}
