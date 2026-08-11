import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import OpenGrowAPIService from "../src/opengrow_api_service.js";
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

test("the application SDK origin is mandatory and normalized", () => {
  assert.throws(
    () => new OpenGrowManager("key", false, () => {}, "/relative"),
    /absolute HTTP\(S\) URL/,
  );
  assert.throws(
    () => new OpenGrowManager("key", false, () => {}, "ftp://example.com"),
    /absolute HTTP\(S\) URL/,
  );

  new OpenGrowManager(
    "project-key",
    false,
    () => {},
    "https://sdk.example.com/an-ignored-path?ignored=true",
  );
  assert.equal(
    OpenGrowContext.API_BASE_URL,
    "https://sdk.example.com/api/v1/sdk",
  );
});

test("manager construction is safe during server-side rendering", () => {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.localStorage;
  delete globalThis.navigator;

  assert.doesNotThrow(
    () =>
      new OpenGrowManager(
        "project-key",
        false,
        () => {},
        "https://sdk.example.com",
      ),
  );
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

test("GET requests never accept or send a request body", () => {
  const helper = new OpenGrowAPIServiceHelper();
  let response;
  let failure;
  helper.GET(
    "/messages",
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
  request.respond({ responseText: '{"notifications":[]}' });
  assert.deepEqual(response, { notifications: [] });
  assert.equal(failure, undefined);
});

test("HTTP and malformed JSON responses are fail-closed", () => {
  const helper = new OpenGrowAPIServiceHelper();
  const responses = [];
  const failures = [];

  helper.GET("/unauthorized", responses.push.bind(responses), failures.push.bind(failures));
  MockXMLHttpRequest.instances.at(-1).respond({
    status: 401,
    responseText: '{"unexpected":"success"}',
    statusText: "Unauthorized",
  });
  helper.GET("/invalid-json", responses.push.bind(responses), failures.push.bind(failures));
  MockXMLHttpRequest.instances.at(-1).respond({ responseText: "not-json" });

  assert.deepEqual(responses, []);
  assert.deepEqual(failures, [
    "Unauthorized",
    "OpenGrow API returned invalid JSON",
  ]);
});

test("API service GET endpoints use the body-free helper contract", () => {
  const service = new OpenGrowAPIService();
  const calls = [];
  service.apiService = {
    GET(...args) {
      calls.push(args);
    },
  };
  const success = () => {};
  const failure = () => {};

  service.messagesForAutomaticDisplay(success, failure);
  service.numberOfUnreadMessages(success, failure);

  assert.deepEqual(calls, [
    ["/notifications_to_display_automatically", success, failure],
    ["/number_of_unread_notifications", success, failure],
  ]);
});

test("authentication maps identifier and attributes to their correct fields", () => {
  const manager = new OpenGrowManager(
    "project-key",
    false,
    () => {},
    "https://sdk.example.com",
  );
  let flushes = 0;
  manager.eventsManager = {
    flushEvents() {
      flushes += 1;
    },
  };
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
  assert.equal(flushes, 1);
});

test("an authentication error stops every authenticated follow-up request", () => {
  const manager = new OpenGrowManager(
    "project-key",
    false,
    () => {},
    "https://sdk.example.com",
  );
  let followUpNetworkCalls = 0;
  let flushes = 0;
  const countNetworkCall = () => {
    followUpNetworkCalls += 1;
  };
  manager.eventsManager = {
    flushEvents() {
      flushes += 1;
    },
  };
  manager.uiHelper = { showMessagesList: countNetworkCall };
  manager.service = {
    authenticateDevice(_details, _success, failure) {
      failure("Unauthorized");
    },
    payloadForDevice: countNetworkCall,
    messagesForAutomaticDisplay: countNetworkCall,
    setUserAttributes: countNetworkCall,
    createLink: countNetworkCall,
    messagesForDevice: countNetworkCall,
    numberOfUnreadMessages: countNetworkCall,
    markMessageAsViewed: countNetworkCall,
  };
  const authenticationFailures = [];

  manager.authenticate(() => assert.fail("authentication unexpectedly succeeded"), (error) => {
    authenticationFailures.push(error);
  });
  manager.setUserIdentifier("user-after-failure");
  manager.setUserAttributes({ plan: "blocked" });

  const operationFailures = [];
  const fail = (error) => operationFailures.push(error);
  manager.createLink(null, null, null, null, () => {}, fail);
  manager.getMessages(1, () => {}, fail);
  manager.getNumberOfUnreadMessages(() => {}, fail);
  manager.markMessageAsRead({ id: "message" }, () => {}, fail);
  manager.showMessagesList(fail);

  assert.deepEqual(authenticationFailures, ["Unauthorized"]);
  assert.equal(manager.authenticated, false);
  assert.equal(followUpNetworkCalls, 0);
  assert.equal(flushes, 0);
  assert.equal(operationFailures.length, 5);
  for (const error of operationFailures) {
    assert.match(error, /not authenticated/);
  }
});

test("a stale authentication response cannot override a newer failure", () => {
  const manager = new OpenGrowManager(
    "project-key",
    false,
    () => {},
    "https://sdk.example.com",
  );
  const attempts = [];
  manager.service = {
    authenticateDevice(_details, success, failure) {
      attempts.push({ success, failure });
    },
  };
  const failures = [];

  manager.authenticate();
  manager.authenticate(null, failures.push.bind(failures));
  attempts[1].failure("newer failure");
  attempts[0].success({
    linksquared: "stale-visitor",
    sdk_identifier: "stale-user",
    sdk_attributes: { stale: true },
  });

  assert.deepEqual(failures, ["newer failure"]);
  assert.equal(manager.authenticated, false);
  assert.equal(OpenGrowContext.USER_IDENTIFIER, null);
  assert.equal(OpenGrowContext.USER_ATTRIBUTES, null);
});

test("URLSearchParams values are decoded exactly once", () => {
  window.location.href =
    "https://app.example.com/?OpenGrow=a%252Fb%26hello%2Bworld";
  assert.equal(
    OpenGrowDeviceDetails.getOpenGrowPath(),
    "a%2Fb&hello+world",
  );
});

test("attribution lookup is safe without window.location and consumes persisted data once", () => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "OpenGrow Electron test" },
  });
  localStorage.setItem("OpenGrow_path", "persisted%2Fpath");
  delete globalThis.window;

  assert.equal(OpenGrowDeviceDetails.getOpenGrowPath(), "persisted%2Fpath");
  assert.equal(OpenGrowDeviceDetails.getOpenGrowPath(), null);

  delete globalThis.navigator;
  delete globalThis.document;
  assert.equal(OpenGrowDeviceDetails.getOpenGrowPath(), null);
  assert.deepEqual(OpenGrowDeviceDetails.currentDetails(), {
    user_agent: "unknown",
    app_version: "0",
    build: "0",
  });
});
