import assert from "node:assert/strict";
import test from "node:test";
import { assertBillingConfigOwnership } from "./cloudflare-billing-config.mjs";

const resources = {
  queues: {
    billing: "billing-jobs",
    billingDlq: "billing-jobs-dlq",
  },
};

test("service mode assigns the financial queue and schedule only to Billing", () => {
  assert.doesNotThrow(() =>
    assertBillingConfigOwnership({
      apiConfig: config({ producer: true }),
      billingConfig: config({
        producer: true,
        consumer: true,
        deadLetterConsumer: true,
        scheduled: true,
      }),
      mode: "service",
      resources,
    }),
  );
});

test("local compatibility mode assigns the financial queue only to API", () => {
  assert.doesNotThrow(() =>
    assertBillingConfigOwnership({
      apiConfig: config({ producer: true, consumer: true }),
      billingConfig: config({ producer: true, deadLetterConsumer: true }),
      mode: "local",
      resources,
    }),
  );
});

test("rejects duplicate consumers across execution domains", () => {
  assert.throws(
    () =>
      assertBillingConfigOwnership({
        apiConfig: config({ producer: true, consumer: true }),
        billingConfig: config({
          producer: true,
          consumer: true,
          deadLetterConsumer: true,
          scheduled: true,
        }),
        mode: "service",
        resources,
      }),
    /exactly one generated consumer/,
  );
});

test("rejects a financial consumer without its DLQ", () => {
  const billingConfig = config({
    producer: true,
    consumer: true,
    deadLetterConsumer: true,
    scheduled: true,
  });
  delete billingConfig.queues.consumers[0].dead_letter_queue;
  assert.throws(
    () =>
      assertBillingConfigOwnership({
        apiConfig: config({ producer: true }),
        billingConfig,
        mode: "service",
        resources,
      }),
    /invalid dead_letter_queue/,
  );
});

test("rejects service mode without Billing reconciliation", () => {
  assert.throws(
    () =>
      assertBillingConfigOwnership({
        apiConfig: config({ producer: true }),
        billingConfig: config({
          producer: true,
          consumer: true,
          deadLetterConsumer: true,
        }),
        mode: "service",
        resources,
      }),
    /scheduled reconciliation/,
  );
});

function config({
  producer = false,
  consumer = false,
  deadLetterConsumer = false,
  scheduled = false,
}) {
  const consumers = [];
  if (consumer) {
    consumers.push({
      queue: resources.queues.billing,
      max_batch_size: 10,
      max_batch_timeout: 5,
      max_retries: 8,
      dead_letter_queue: resources.queues.billingDlq,
    });
  }
  if (deadLetterConsumer) {
    consumers.push({
      queue: resources.queues.billingDlq,
      max_batch_size: 10,
      max_batch_timeout: 5,
      max_retries: 8,
    });
  }
  return {
    vars: {
      BILLING_QUEUE_NAME: resources.queues.billing,
      BILLING_DLQ_NAME: resources.queues.billingDlq,
    },
    queues: {
      producers: producer
        ? [{ binding: "BILLING_QUEUE", queue: resources.queues.billing }]
        : [],
      consumers,
    },
    ...(scheduled ? { triggers: { crons: ["*/10 * * * *"] } } : {}),
  };
}
