export interface BuildSucceededEvent {
	type: "cf.workersBuilds.worker.build.succeeded";
	source: {
		type: "workersBuilds.worker";
		workerName: string;
	};
	payload: {
		buildUuid: string;
		status: "success";
		buildOutcome: "success";
		createdAt: string;
		initializingAt: string;
		runningAt: string;
		stoppedAt: string;
		buildTriggerMetadata: {
			buildTriggerSource: string;
			branch: string;
			commitHash: string;
			commitMessage: string;
			author: string;
			buildCommand: string;
			deployCommand: string;
			rootDirectory: string;
			repoName: string;
			providerAccountName: string;
			providerType: string;
		};
	};
	metadata: {
		accountId: string;
		eventSubscriptionId: string;
		eventSchemaVersion: number;
		eventTimestamp: string;
	};
}

export interface UnknownEvent {
	type: string;
	source?: unknown;
	payload?: unknown;
	metadata?: unknown;
}

export type PerfQueueMessage = BuildSucceededEvent | UnknownEvent;

export function isBuildSucceeded(event: PerfQueueMessage): event is BuildSucceededEvent {
	return event.type === "cf.workersBuilds.worker.build.succeeded";
}
