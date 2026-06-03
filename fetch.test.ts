import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, existsSync, readFileSync } from "node:fs";
import { categorize, htmlToMarkdown, prettyJson, applyGate, collectBody } from "./fetch.ts";

const empty = Buffer.alloc(0);
const withNul = Buffer.from([0x68, 0x00, 0x69]); // "h\0i"

test("categorize: html → markdown, raw forces text", () => {
	assert.equal(categorize("text/html; charset=utf-8", empty, false), "markdown");
	assert.equal(categorize("text/html", empty, true), "text");
	assert.equal(categorize("application/xhtml+xml", empty, false), "markdown");
});

test("categorize: raw=true skips JSON pretty-print (→ text), never overrides binary", () => {
	assert.equal(categorize("application/json", empty, true), "text");
	assert.equal(categorize("application/ld+json", empty, true), "text");
	assert.equal(categorize("image/png", empty, true), "binary"); // binary not overridden by raw
	assert.equal(categorize("application/octet-stream", withNul, true), "binary"); // NUL detection not overridden
});

test("categorize: json variants → json", () => {
	assert.equal(categorize("application/json", empty, false), "json");
	assert.equal(categorize("application/ld+json", empty, false), "json");
});

test("categorize: xml/text/js → text", () => {
	assert.equal(categorize("application/xml", empty, false), "text");
	assert.equal(categorize("application/atom+xml", empty, false), "text");
	assert.equal(categorize("text/plain", empty, false), "text");
	assert.equal(categorize("application/javascript", empty, false), "text");
});

test("categorize: images (incl svg) → binary", () => {
	assert.equal(categorize("image/png", empty, false), "binary");
	assert.equal(categorize("image/svg+xml", empty, false), "binary");
});

test("categorize: known binary → binary", () => {
	assert.equal(categorize("application/pdf", empty, false), "binary");
	assert.equal(categorize("application/zip", empty, false), "binary");
});

test("categorize: octet-stream / empty / unknown decided by NUL sniff", () => {
	assert.equal(categorize("application/octet-stream", empty, false), "text");
	assert.equal(categorize("application/octet-stream", withNul, false), "binary");
	assert.equal(categorize("", empty, false), "text");
	assert.equal(categorize("application/x-unknown-thing", empty, false), "text");
});

test("categorize: NUL byte downgrades a text candidate to binary", () => {
	assert.equal(categorize("text/html", withNul, false), "binary");
	assert.equal(categorize("application/json", withNul, false), "binary");
});

test("htmlToMarkdown: article structure preserved", () => {
	const body = "<p>" + "Readability needs a few hundred characters of real prose before it treats a node as the main article body, so this paragraph is deliberately long and repetitive to clear the default character threshold. ".repeat(4) + "</p>";
	const html = `<!doctype html><html><head><title>My Title</title></head><body><article><h2>Section</h2>${body}<ul><li>first</li><li>second</li></ul><pre><code>const x = 1;</code></pre><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></article></body></html>`;
	const md = htmlToMarkdown(html, "https://example.com/post");
	assert.ok(md, "expected markdown, got null");
	assert.match(md!, /^# My Title/);
	assert.match(md!, /## Section/);
	assert.match(md!, /-\s+first/); // turndown emits `-   first` (3 spaces); tolerate any whitespace
	assert.match(md!, /\| A \| B \|/);
	assert.match(md!, /```/);
});

test("htmlToMarkdown: unparseable / empty → null", () => {
	// Empty body: readability finds no extractable content → null
	assert.equal(htmlToMarkdown("<html><body></body></html>", "https://example.com"), null);
	// Empty string: JSDOM creates an empty document → null
	assert.equal(htmlToMarkdown("", "https://example.com"), null);
});

test("prettyJson: valid is indented, invalid is passthrough", () => {
	assert.equal(prettyJson('{"a":1,"b":[2,3]}'), '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
	assert.equal(prettyJson("not json"), "not json");
});

test("applyGate: boundaries at 32 KB / 1000 lines", () => {
	assert.equal(applyGate("").spill, false);
	assert.equal(applyGate("small").spill, false);
	assert.equal(applyGate("x".repeat(32_001)).spill, true);
	assert.equal(applyGate(Array(1001).fill("y").join("\n")).spill, true);
	const r = applyGate("a\nb\nc");
	assert.equal(r.lines, 3);
	assert.equal(r.bytes, 5);
});

// --- collectBody integration tests (no network; uses Response with in-memory body) ---

function makeResponse(body: Uint8Array | string, contentType: string): Response {
	// Buffer is Uint8Array<ArrayBuffer> in Node types, satisfying BodyInit's strict generic
	const bytes = typeof body === "string" ? Buffer.from(body) : Buffer.from(body);
	return new Response(bytes, { headers: { "content-type": contentType } });
}

test("collectBody: text/plain → text category, buffer defined, not truncated", async () => {
	const res = makeResponse("hello world", "text/plain");
	const ct = res.headers.get("content-type") ?? "";
	const result = await collectBody(res, ct, false);
	assert.equal(result.category, "text");
	assert.ok(result.buffer, "buffer should be defined");
	assert.equal(result.truncated, false);
	assert.equal(result.file, undefined);
});

test("collectBody: application/json → json category", async () => {
	const res = makeResponse('{"x":1}', "application/json");
	const ct = res.headers.get("content-type") ?? "";
	const result = await collectBody(res, ct, false);
	assert.equal(result.category, "json");
	assert.ok(result.buffer);
	assert.equal(result.truncated, false);
});

test("collectBody: text/html + raw=false → markdown; raw=true → text", async () => {
	const html = "<html><head><title>T</title></head><body><p>hello</p></body></html>";
	const res1 = makeResponse(html, "text/html");
	const ct = res1.headers.get("content-type") ?? "";
	const r1 = await collectBody(res1, ct, false);
	assert.equal(r1.category, "markdown");

	const res2 = makeResponse(html, "text/html");
	const r2 = await collectBody(res2, ct, true);
	assert.equal(r2.category, "text");
});

test("collectBody: image/png → binary, file written to disk, content matches", async () => {
	// PNG magic bytes
	const magic = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const res = makeResponse(magic, "image/png");
	const ct = res.headers.get("content-type") ?? "";
	const result = await collectBody(res, ct, false);
	assert.equal(result.category, "binary");
	assert.equal(result.buffer, undefined);
	assert.ok(result.file, "file path should be defined");
	assert.ok(existsSync(result.file!), "file should exist on disk");
	const written = readFileSync(result.file!);
	assert.deepEqual(written, Buffer.from(magic));
	rmSync(result.file!);
});

test("collectBody: text truncation at 1MB — truncated=true, buffer capped", async () => {
	const PARSABLE_MAX = 1_000_000;
	const oversized = "a".repeat(PARSABLE_MAX + 50_000);
	const res = makeResponse(oversized, "text/plain");
	const ct = res.headers.get("content-type") ?? "";
	const result = await collectBody(res, ct, false);
	assert.equal(result.truncated, true);
	assert.equal(result.category, "text");
	assert.ok(result.buffer);
	assert.equal(result.buffer!.length, PARSABLE_MAX);
});
