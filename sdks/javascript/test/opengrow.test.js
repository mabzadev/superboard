import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import OpenGrowAPIServiceHelper from "../src/opengrow_api_service_helper.js";
import OpenGrowContext from "../src/opengrow_context.js";
import OpenGrowDeviceDetails from "../src/opengrow_device_details.js";
import OpenGrowManager from "../src/opengrow_manager.js";

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }

  removeItem(key) {
    this.#values.delete(key);
  }
}

class MockXMLHttpRequest {
  static DONE = 4;
  static instances = [];

  constructor() {
    this.headers = {};
    MockXMLHttpRequest.instances.push(this);
  }

  open(method, endpoint, async) {
    Object.assign(this, { method, endpoint, async });
  }

  setRequestHeader(name, value) {
    this.headers[name] = value;
  }

  send(body) {
    this.body = body;
  }

  respond({ status = 200, responseText = "{}", statusText = "" } = {}) {
    Object.assign(this, {
      readyState: MockXMLHttpRequest.DONE,
      status,
      responseText,
      statusText,
    });
    this.onreadystatechange();
  }
}

function installBrowser() {
  globalThis.localStorage = new MemoryStorage();
  globalThis.document = { cookie: "" };
  globalThis.window = {
    addEventListener() {},
    location: {
      protocol: "https:",
      hostname: "app.example.com",
      port: "8443",
      href: "https://app.example.com:8443/",
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "OpenGrow test browser" },
  });
}

beforeEach(() => {
  installBrowser();
  globalThis.XMLHttpRequest = MockXMLHttpRequest;
  MockXMLHttpRequest.instances = [];
  OpenGrowContext.API_BASE_URL = "https://sdk.example.com/api/v1/sdk";
  OpenGrowContext.API_KEY = null;
  OpenGrowContext.testEnvironment = false;
  OpenGrowContext.USER_IDENTIFIER = null;
  OpenGrowContext.USER_ATTRIBUTES = null;
});

test("headers are environment-aware and safe without window", () => {
  OpenGrowContext.API_KEY = "project-key";
  OpenGrowContext.testEnvironment = true;
  const helper = new OpenGrowAPIServiceHelper();
  assert.deepEqual(helper.buildHeaders(), {
    "Content-Type": "application/json",
    PLATFORM: "web",
    IDENTIFIER: "https://app.example.com:8443",
    PROJECT_KEY: "test_project-key",
  });

  delete globalThis.window;
  delete globalThis.document;
  assert.deepEqual(helper.buildHeaders(), {
    "Content-Type": "application/json",
    PLATFORM: "web",
    PROJECT_KEY: "test_project-key",
  });
});

test("GET requests never send a body and report invalid JSON", () => {
  const helper = new OpenGrowAPIServiceHelper();
  let response;
  let failure;
  helper.GET(
    "/messages",
    { ignored: true },
    (value) => {
      response = value;
    },
    (value) => {
      failure = value;
    },
  );

  const request = MockXMLHttpRequest.instances.at(-1);
  assert.equal(request.method, "GET");
  assert.equal(request.endpoint, "https://sdk.example.com/api/v1/sdk/messages");
  assert.equal(request.body, undefined);
  request.respond({ responseText: "not-json" });
  assert.equal(response, undefined);
  assert.equal(failure, "OpenGrow API returned invalid JSON");
});

test("authentication maps identifier and attributes to their correct fields", () => {
  const manager = new OpenGrowManager(
    "project-key",
    false,
    () => {},
    "https://sdk.example.com",
  );
  manager.eventsManager = { flushEvents() {} };
  manager.service = {
    authenticateDevice(_details, success) {
      success({
        linksquared: "visitor-id",
        sdk_identifier: "account@example.com",
        sdk_attributes: { plan: "pro" },
      });
    },
    payloadForDevice(_details, success) {
      success({ data: null });
    },
    messagesForAutomaticDisplay(success) {
      success({});
    },
    setUserAttributes(success) {
      success({});
    },
  };

  manager.authenticate();
  assert.equal(OpenGrowContext.USER_IDENTIFIER, "account@example.com");
  assert.deepEqual(OpenGrowContext.USER_ATTRIBUTES, { plan: "pro" });
  assert.equal(manager.authenticated, true);
});

test("link creation performs no network request before authentication", () => {
  const manager = Object.create(OpenGrowManager.prototype);
  manager.authenticated = false;
  let networkCalls = 0;
  manager.service = {
    createLink() {
      networkCalls += 1;
    },
  };
  let failure;

  manager.createLink(null, null, null, null, () => {}, (value) => {
    failure = value;
  });

  assert.equal(networkCalls, 0);
  assert.match(failure, /not yet initialized/);
});

test("URLSearchParams values are not decoded twice", () => {
  window.location.href = "https://app.example.com/?OpenGrow=a%252Fb";
  assert.equal(OpenGrowDeviceDetails.getOpenGrowPath(), "a%2Fb");
});
