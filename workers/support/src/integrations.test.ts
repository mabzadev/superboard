import { describe, expect, it } from "vitest";
import {
  nativeIntegrationCredentialState,
  validateNativeIntegrationSettings,
} from "./integrations";

describe("native Support integration contracts", () => {
  it("requires an access token before OAuth-backed integrations are runnable", () => {
    expect(nativeIntegrationCredentialState("linear", {
      client_id: "client",
      client_secret: "secret",
    })).toEqual({
      configured: false,
      credentialFields: ["client_id", "client_secret"],
    });
    expect(nativeIntegrationCredentialState("linear", {
      client_id: "client",
      client_secret: "secret",
      access_token: "token",
    })?.configured).toBe(true);
  });

  it("accepts only provider-specific actions explicitly allowlisted in settings", () => {
    expect(validateNativeIntegrationSettings("slack", {
      workflow_action: "post_message",
      allowed_actions: ["post_message"],
      channel_id: "C123ABC456",
      message_template: "{{conversation.subject}}",
    })).toEqual({ action: "post_message" });
    expect(validateNativeIntegrationSettings("linear", {
      workflow_action: "create_issue",
      allowed_actions: ["create_issue"],
      team_id: "9cfb482a-81e3-4154-b5b9-2c805e70a02d",
    })).toEqual({ action: "create_issue" });
    expect(validateNativeIntegrationSettings("notion", {
      workflow_action: "update_page_title",
      allowed_actions: ["update_page_title"],
      page_id: "d9824bdc-8445-4327-be8b-5b47500af6ce",
    })).toEqual({ action: "update_page_title" });
    expect(validateNativeIntegrationSettings("shopify", {
      workflow_action: "add_tags",
      allowed_actions: ["add_tags"],
      shop_domain: "example.myshopify.com",
      resource_id: "gid://shopify/Customer/544365967",
      tags: ["support"],
    })).toEqual({ action: "add_tags" });
  });

  it("rejects generic side effects and unallowlisted template variables", () => {
    expect(() => validateNativeIntegrationSettings("slack", {
      workflow_action: "http_request",
      allowed_actions: ["http_request"],
      endpoint_url: "https://example.com",
    })).toThrowError(expect.objectContaining({ code: "configuration_required" }));
    expect(() => validateNativeIntegrationSettings("linear", {
      workflow_action: "create_issue",
      allowed_actions: ["create_issue"],
      team_id: "9cfb482a-81e3-4154-b5b9-2c805e70a02d",
      description_template: "{{credential.access_token}}",
    })).toThrowError(expect.objectContaining({ code: "configuration_required" }));
  });
});
