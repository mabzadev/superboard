export interface RegistryConfig {
	aggregatorUrl: string;

	acceptLabelers?: string;

	policy?: {
		minimumReleaseAge?: string | number;

		minimumReleaseAgeExclude?: readonly string[];
	};
}

export type RegistryConfigInput = string | RegistryConfig;

export interface ExperimentalConfig {
	registry?: RegistryConfigInput;
}
