import assert from "node:assert/strict";
import test from "node:test";
import { parseQueueConsumer } from "./cloudflare-billing-consumer.mjs";

test("parses one Worker consumer from Wrangler queue information", () => {
  assert.equal(
    parseQueueConsumer(`
    Number of Consumers: 1
    Consumers: worker:billing-worker
  `),
    "billing-worker",
  );
});

test("parses a queue without a consumer", () => {
  assert.equal(parseQueueConsumer("Number of Consumers: 0\n"), null);
});

test("rejects inconsistent consumer output", () => {
  assert.throws(
    () =>
      parseQueueConsumer(`
    Number of Consumers: 1
    Consumers:
  `),
    /Unable to parse queue consumer state/,
  );
});
