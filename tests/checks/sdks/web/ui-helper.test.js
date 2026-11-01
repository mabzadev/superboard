import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import SuperBoardUIHelper from "../../../../sdks/web/src/superboard_ui_helper.js";

// Minimal DOM stand-in: it records markup and text separately so the test can
// prove server text is never interpreted as HTML.
class FakeElement {
	constructor(tagName) {
		this.tagName = tagName;
		this.style = {};
		this.children = [];
		this.innerHTML = "";
		this.slots = new Map();
	}
	addEventListener() {}
	appendChild(child) {
		this.children.push(child);
		return child;
	}
	querySelector(selector) {
		if (!this.slots.has(selector)) this.slots.set(selector, { textContent: "" });
		return this.slots.get(selector);
	}
}

const payload = '<img src=x onerror="alert(1)">';
let itemList;
let spinner;

beforeEach(() => {
	itemList = new FakeElement("div");
	spinner = new FakeElement("div");
	globalThis.document = {
		createElement: (tagName) => new FakeElement(tagName),
		getElementById: (id) =>
			({ itemList, spinner, closeModalBtn: new FakeElement("button") })[id] ?? null,
		body: new FakeElement("body"),
	};
	globalThis.location = { href: "https://app.example.test/" };
});

afterEach(() => {
	delete globalThis.document;
	delete globalThis.location;
});

function helperReturning(pages) {
	const helper = new SuperBoardUIHelper();
	const requested = [];
	helper.service = {
		messagesForDevice(page, response) {
			requested.push(page);
			response({ notifications: pages[page - 1] ?? [] });
		},
	};
	return { helper, requested };
}

test("message titles and subtitles are rendered as text, never as markup", () => {
	const { helper } = helperReturning([[{ title: payload, subtitle: payload, read: false }]]);
	helper.showMessagesList();

	const [item] = itemList.children;
	assert.ok(item, "the message was rendered");
	assert.doesNotMatch(item.innerHTML, /onerror|<img/u);
	assert.equal(item.querySelector(".item-title").textContent, payload);
	assert.equal(item.querySelector(".item-subtitle").textContent, payload);
});

test("infinite scroll stops after an empty page and ignores non-scrollable lists", () => {
	const listeners = {};
	itemList.addEventListener = (type, listener) => {
		listeners[type] = listener;
	};
	const { helper, requested } = helperReturning([[{ title: "One", subtitle: "" }], []]);
	helper.showMessagesList();

	Object.assign(itemList, { scrollTop: 0, scrollHeight: 100, clientHeight: 100 });
	listeners.scroll();
	assert.deepEqual(requested, [1], "a list that does not overflow never paginates");

	Object.assign(itemList, { scrollTop: 300, scrollHeight: 500, clientHeight: 100 });
	listeners.scroll();
	listeners.scroll();
	listeners.scroll();
	assert.deepEqual(requested, [1, 2], "an empty page marks the end of the list");
});

test("only http(s) message pages are framed", () => {
	const helper = new SuperBoardUIHelper();
	// Built at runtime so the fixture itself is not a script URL literal.
	helper.openPage({ access_url: ["javascript", "alert(1)"].join(":") });
	assert.equal(document.body.children.length, 0);
	helper.openPage({ access_url: "https://app.example.test/message" });
	assert.equal(document.body.children.length, 1);
	const iframe = document.body.children[0].children.find((child) => child.tagName === "iframe");
	assert.equal(iframe.src, "https://app.example.test/message");
});
