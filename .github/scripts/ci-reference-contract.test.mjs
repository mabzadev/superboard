import assert from "node:assert/strict";
import test from "node:test";
import { referenceCheckoutMetadata } from "./ci-reference-contract.mjs";

test("reference checkout metadata comes from the control plane", () => {
  assert.deepEqual(
    referenceCheckoutMetadata({
      repositories: {
        reference: {
          nameWithOwner: "another-account/reference-application",
          defaultBranch: "integration",
        },
      },
    }),
    {
      repository: "another-account/reference-application",
      ref: "integration",
    },
  );
});

test("reference checkout metadata rejects unsafe values", () => {
  assert.throws(
    () =>
      referenceCheckoutMetadata({
        repositories: {
          reference: { nameWithOwner: "missing-owner", defaultBranch: "dev" },
        },
      }),
    /owner\/name/u,
  );
  assert.throws(
    () =>
      referenceCheckoutMetadata({
        repositories: {
          reference: {
            nameWithOwner: "account/reference",
            defaultBranch: "../unsafe",
          },
        },
      }),
    /unsupported/u,
  );
});
