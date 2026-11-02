import { Client, ok, simpleFetchHandler } from "@atcute/client";
import { safeParse } from "@atcute/lexicons/validations";
import {
	AggregatorGetLatestRelease,
	AggregatorGetPackage,
	AggregatorListReleases,
	AggregatorResolvePackage,
	AggregatorSearchPackages,
	PackageProfile,
	PackageRelease,
} from "@emdash-cms/registry-lexicons";

import {
	mapListingStatus,
	registryLabelerPolicy,
	type ListingStatusResult,
	type RegistryLabelerPolicy,
} from "../listing-policy.js";

export {
	registryLabelerPolicy,
	registryLabelerPolicyKey,
	type ApprovedListing,
	type ListingStatusResult,
	type RegistryLabelerPolicy,
	type UnavailableListing,
} from "../listing-policy.js";

export type ValidatedPackageView = Omit<AggregatorGetPackage.$output, "profile"> & {
	profile: PackageProfile.Main | null;
};

export type ValidatedReleaseView = Omit<AggregatorGetLatestRelease.$output, "release"> & {
	release: PackageRelease.Main | null;
};

export type ValidatedSearchPackages = Omit<AggregatorSearchPackages.$output, "packages"> & {
	packages: ValidatedPackageView[];
};

export type ValidatedListReleases = Omit<AggregatorListReleases.$output, "releases"> & {
	releases: ValidatedReleaseView[];
};

function validateProfile(raw: unknown): PackageProfile.Main | null {
	const result = safeParse(PackageProfile.mainSchema, raw);
	return result.ok ? result.value : null;
}

function validateRelease(raw: unknown): PackageRelease.Main | null {
	const result = safeParse(PackageRelease.mainSchema, raw);
	return result.ok ? result.value : null;
}

export interface DiscoveryClientOptions {
	aggregatorUrl: string;

	acceptLabelers?: string;

	labelerPolicy?: RegistryLabelerPolicy;

	fetch?: typeof fetch;
}

export class DiscoveryClient {
	readonly aggregatorUrl: string;
	readonly acceptLabelers: string | undefined;
	readonly labelerPolicy: RegistryLabelerPolicy;
	readonly #client: Client;

	constructor(options: DiscoveryClientOptions) {
		this.aggregatorUrl = options.aggregatorUrl;
		const configuredPolicy = registryLabelerPolicy(options.labelerPolicy?.acceptLabelers);
		const legacyPolicy = registryLabelerPolicy(options.acceptLabelers);
		if (
			configuredPolicy.acceptLabelers !== undefined &&
			legacyPolicy.acceptLabelers !== undefined &&
			configuredPolicy.acceptLabelers !== legacyPolicy.acceptLabelers
		) {
			throw new TypeError(
				"labelerPolicy.acceptLabelers must match acceptLabelers when both are set",
			);
		}
		this.labelerPolicy = registryLabelerPolicy(
			configuredPolicy.acceptLabelers ?? legacyPolicy.acceptLabelers,
		);
		this.acceptLabelers = this.labelerPolicy.acceptLabelers;

		const baseHandler = simpleFetchHandler({
			service: options.aggregatorUrl,
			fetch: options.fetch ?? globalThis.fetch,
		});

		const acceptLabelers = this.acceptLabelers;
		const handler: typeof baseHandler = acceptLabelers
			? async (pathname, init) => {
					const headers = new Headers(init.headers);
					headers.set("atproto-accept-labelers", acceptLabelers);
					return baseHandler(pathname, { ...init, headers });
				}
			: baseHandler;

		this.#client = new Client({ handler });
	}

	async searchPackages(params: AggregatorSearchPackages.$params): Promise<ValidatedSearchPackages> {
		const out = await ok(this.#client.call(AggregatorSearchPackages, { params }));
		return {
			...out,
			packages: out.packages.map((p) => ({ ...p, profile: validateProfile(p.profile) })),
		};
	}

	async getPackage(params: AggregatorGetPackage.$params): Promise<ValidatedPackageView> {
		const out = await ok(this.#client.call(AggregatorGetPackage, { params }));
		return { ...out, profile: validateProfile(out.profile) };
	}

	getPackageStatus(
		params: AggregatorGetPackage.$params,
	): Promise<ListingStatusResult<ValidatedPackageView>> {
		return mapListingStatus(this.getPackage(params));
	}

	async resolvePackage(params: AggregatorResolvePackage.$params): Promise<ValidatedPackageView> {
		const out = await ok(this.#client.call(AggregatorResolvePackage, { params }));
		return { ...out, profile: validateProfile(out.profile) };
	}

	resolvePackageStatus(
		params: AggregatorResolvePackage.$params,
	): Promise<ListingStatusResult<ValidatedPackageView>> {
		return mapListingStatus(this.resolvePackage(params));
	}

	async listReleases(params: AggregatorListReleases.$params): Promise<ValidatedListReleases> {
		const out = await ok(this.#client.call(AggregatorListReleases, { params }));
		return {
			...out,
			releases: out.releases.map((r) => ({ ...r, release: validateRelease(r.release) })),
		};
	}

	async getLatestRelease(
		params: AggregatorGetLatestRelease.$params,
	): Promise<ValidatedReleaseView> {
		const out = await ok(this.#client.call(AggregatorGetLatestRelease, { params }));
		return { ...out, release: validateRelease(out.release) };
	}
}
