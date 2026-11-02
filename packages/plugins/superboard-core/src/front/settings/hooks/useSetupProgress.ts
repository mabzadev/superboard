import { useState, useEffect, useCallback, useRef } from "react";

import {
	getSetupProgressAPICall,
	completeSetupStepAPICall,
} from "../api/instances/instanceService.js";

export function useSetupProgress(
	instanceId: string | undefined,
	category: string,
	identifiers: readonly string[],
) {
	const [walkedSteps, setWalkedSteps] = useState<Set<number>>(new Set());
	const identifiersRef = useRef(identifiers);
	identifiersRef.current = identifiers;

	useEffect(() => {
		if (!instanceId) return;

		setWalkedSteps(new Set());

		let stale = false;
		const fetchProgress = async () => {
			try {
				const response = await getSetupProgressAPICall(instanceId, category);
				if (stale) return;
				const steps = response.data?.steps;
				if (steps && steps.length > 0) {
					const ids = identifiersRef.current;
					const indices = new Set<number>();
					steps.forEach((s: { step_identifier: string; completed_at?: string }) => {
						const idx = ids.indexOf(s.step_identifier);
						if (idx !== -1) indices.add(idx);
					});
					setWalkedSteps((prev) => new Set([...prev, ...indices]));
				}
			} catch {}
		};
		fetchProgress();

		return () => {
			stale = true;
		};
	}, [instanceId, category]);

	const markStepComplete = useCallback(
		(stepIndex: number) => {
			const ids = identifiersRef.current;
			if (stepIndex < 0 || stepIndex >= ids.length) return;

			setWalkedSteps((prev) => new Set([...prev, stepIndex]));

			if (instanceId) {
				completeSetupStepAPICall(instanceId, category, ids[stepIndex]!).catch(() => {});
			}
		},
		[instanceId, category],
	);

	const reset = useCallback(() => {
		setWalkedSteps(new Set());
	}, []);

	return { walkedSteps, markStepComplete, reset };
}
