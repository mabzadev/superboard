import { describe, expect, it } from "vitest";
import {
  readJsonObjectLimited,
  readRequestObjectLimited,
  readTextLimited,
} from "./request-body";

describe("bounded request bodies", () => {
  it("reads an object below the configured byte limit", async () => {
    await expect(readJsonObjectLimited(new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ name: "OpenGrow" }),
    }), 1_024)).resolves.toEqual({ name: "OpenGrow" });
  });

  it("rejects an announced oversized body before reading it", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-length": "2048" },
      body: "{}",
    });
    await expect(readTextLimited(request, 1_024)).rejects.toMatchObject({
      code: "body_too_large",
      status: 413,
    });
  });

  it("rejects a streamed body that grows past the limit", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("1234"));
          controller.enqueue(new TextEncoder().encode("5678"));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(readTextLimited(request, 7)).rejects.toMatchObject({
      code: "body_too_large",
      status: 413,
    });
  });

  it("rejects invalid JSON and non-object JSON", async () => {
    await expect(readJsonObjectLimited(new Response("{"), 100)).rejects.toMatchObject({
      code: "json_invalid",
      status: 400,
    });
    await expect(readJsonObjectLimited(new Response("[]"), 100)).rejects.toMatchObject({
      code: "json_object_required",
      status: 422,
    });
  });

  it("parses form bodies through the same byte limit", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code&code=abc",
    });
    await expect(readRequestObjectLimited(request, 100)).resolves.toEqual({
      grant_type: "authorization_code",
      code: "abc",
    });
  });
});
