export { FakeRepo, type FakeRepoOptions } from "./fake-repo.js";
export { MockPds } from "./mock-pds.js";
export {
	MockDidResolver,
	buildDidDocument,
	type BuildDidDocumentOptions,
	type DidDocument,
} from "./mock-did-resolver.js";
export {
	MockJetstream,
	type JetstreamCommitEvent,
	type JetstreamEvent,
	type MockJetstreamSubscribeOptions,
	type MockJetstreamSubscription,
} from "./mock-jetstream.js";
export {
	FakePublisher,
	PROFILE_NSID,
	RELEASE_NSID,
	createFakePublisherFixture,
	publisherDidKey,
	parseDidKey,
	type CreateFakePublisherFixtureOptions,
	type FakePublisherFixture,
	type FakePublisherOptions,
	type PublishProfileOptions,
	type PublishReleaseOptions,
} from "./fake-publisher.js";
export type { AtprotoDid } from "./types.js";
