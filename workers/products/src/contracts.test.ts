import { describe, expect, it } from "vitest";
import {
  parseOffering,
  parseProduct,
  parsePurchase,
  parseResolveOffering,
  parseStoreSync,
} from "./contracts";

describe("products contracts v1", () => {
  it("parses SDK offering context without trusting a body project id", () => {
    expect(
      parseResolveOffering({
        placement: "main",
        customer_id: "cus_1",
        platform: "ios",
      }),
    ).toEqual({ placement: "main", customer_id: "cus_1", platform: "ios" });
  });
  it("validates products and associations", () => {
    expect(
      parseProduct({
        identifier: "pro.monthly",
        display_name: "Pro monthly",
        product_type: "subscription",
      }),
    ).toMatchObject({ status: "active", product_type: "subscription" });
    expect(
      parseOffering({
        identifier: "default",
        display_name: "Default",
        placement: "main",
        package_ids: ["pkg", "pkg"],
      }).package_ids,
    ).toEqual(["pkg"]);
  });
  it("rejects unsupported product types and unsafe identifiers", () => {
    expect(() =>
      parseProduct({
        identifier: "bad id",
        display_name: "Bad",
        product_type: "service",
      }),
    ).toThrow();
  });
  it("normalizes a financial purchase and validates currency", () => {
    expect(
      parsePurchase({
        financial_customer_id: "customer",
        product_id: "product",
        store: "apple",
        environment: "sandbox",
        external_transaction_id: "tx",
        currency: "usd",
      }),
    ).toMatchObject({
      currency: "USD",
      status: "active",
      original_transaction_id: "tx",
    });
    expect(() =>
      parsePurchase({
        financial_customer_id: "customer",
        product_id: "product",
        store: "apple",
        environment: "sandbox",
        external_transaction_id: "tx",
        currency: "dollars",
      }),
    ).toThrow("currency");
  });
  it("bounds catalog synchronization payloads", () => {
    expect(
      parseStoreSync({
        store: "google",
        environment: "production",
        products: [
          {
            store_product_id: "sku",
            identifier: "sku",
            display_name: "SKU",
            product_type: "consumable",
          },
        ],
      }).products,
    ).toHaveLength(1);
    expect(() =>
      parseStoreSync({
        store: "google",
        environment: "production",
        products: new Array(1001).fill({}),
      }),
    ).toThrow("1000");
  });
});
