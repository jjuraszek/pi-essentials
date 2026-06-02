/**
 * Fetch Extension
 *
 * Registers a `fetch` tool that lets the agent retrieve URLs.
 * HTML is converted to text with links preserved as `text (url)` and entities
 * decoded. Response charset is read from the Content-Type header.
 *
 * Context hygiene: large bodies are written to a file under the OS temp dir and
 * only a preview + file handle is returned inline. The agent reads slices with
 * the `read` tool (offset/limit) or greps the file instead of swallowing the
 * whole payload into context. Small bodies are returned inline unchanged.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatSize, keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

interface FetchToolDetails {
	url?: string;
	status?: number;
	contentType?: string;
	charset?: string;
	bytes?: number;
	truncated?: boolean;
	spilled?: boolean;
	file?: string;
	lines?: number;
}

const MAX_BYTES = 1_000_000; // 1 MB download cap
const DEFAULT_TIMEOUT_MS = 20_000;
// Spill to file when the converted body exceeds either threshold. Matched to
// the `read` tool's own truncation limits so an inline result is always one the
// agent could have read in full anyway.
const INLINE_MAX_BYTES = 50_000;
const INLINE_MAX_LINES = 2000;
const PREVIEW_LINES = 60;
const PREVIEW_MAX_BYTES = 4_000;
const FIREFOX_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:135.0) Gecko/20100101 Firefox/135.0";
const DEFAULT_ACCEPT =
	"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	copy: "\u00a9",
	reg: "\u00ae",
	hellip: "\u2026",
	mdash: "\u2014",
	ndash: "\u2013",
	lsquo: "\u2018",
	rsquo: "\u2019",
	ldquo: "\u201c",
	rdquo: "\u201d",
};

function decodeEntities(s: string): string {
	return s
		.replace(/&#x([0-9a-f]+);/gi, (_, h) =>
			String.fromCodePoint(parseInt(h, 16)),
		)
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
		.replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
}

function htmlToText(html: string): string {
	const withoutScripts = html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");

	const withLinks = withoutScripts.replace(
		/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
		(_, href, inner) => {
			const label = inner.replace(/<[^>]+>/g, "").trim();
			return label ? `${label} (${href})` : `(${href})`;
		},
	);

	const blockBreaks = withLinks
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>/gi, "\n");

	return decodeEntities(blockBreaks.replace(/<[^>]+>/g, ""))
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function parseCharset(contentType: string): string {
	const m = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType);
	return (m?.[1] ?? "utf-8").trim().toLowerCase();
}

function decodeBuffer(buf: ArrayBuffer, charset: string): string {
	try {
		return new TextDecoder(charset, { fatal: false }).decode(buf);
	} catch {
		return new TextDecoder("utf-8", { fatal: false }).decode(buf);
	}
}

function pickExtension(contentType: string, raw: boolean, isHtml: boolean): string {
	if (raw && isHtml) return "html";
	if (contentType.includes("json")) return "json";
	if (contentType.includes("xml")) return "xml";
	return "txt";
}

function spillToFile(url: string, body: string, ext: string): string {
	const dir = join(tmpdir(), "pi-fetch");
	mkdirSync(dir, { recursive: true });
	let host = "page";
	try {
		host = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, "_") || "page";
	} catch {
		// keep default
	}
	const hash = createHash("sha1").update(url).digest("hex").slice(0, 8);
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const file = join(dir, `${stamp}-${host}-${hash}.${ext}`);
	writeFileSync(file, body, "utf8");
	return file;
}

function buildPreview(body: string): string {
	let preview = body.split("\n").slice(0, PREVIEW_LINES).join("\n");
	if (preview.length > PREVIEW_MAX_BYTES) {
		preview = `${preview.slice(0, PREVIEW_MAX_BYTES)}\n…[preview truncated]`;
	}
	return preview;
}

export default function fetchExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "fetch",
		label: "Fetch URL",
		description:
			"Fetch a URL over HTTP(S) and return its body. HTML is converted to text with links inlined as `text (url)`. Download capped at 1MB. Large bodies are written to a temp file and only a preview + file path is returned — read slices of that file with the read tool (offset/limit) or grep it instead of reading the whole thing.",
		promptSnippet: "Fetch the contents of a URL",
		promptGuidelines: [
			"Use fetch when the user provides a URL or asks to read web content.",
			"Pass raw=true only when the caller needs unmodified HTML/JSON.",
			"If the result says the body was written to a file, do not read the whole file blindly — grep it or read with offset/limit to pull only the parts you need.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "Absolute http(s) URL" }),
			method: Type.Optional(
				Type.Union(
					[Type.Literal("GET"), Type.Literal("HEAD"), Type.Literal("POST")],
					{ default: "GET" },
				),
			),
			headers: Type.Optional(
				Type.Record(Type.String(), Type.String(), {
					description: "Extra request headers (override defaults like UA)",
				}),
			),
			body: Type.Optional(Type.String({ description: "Request body for POST" })),
			raw: Type.Optional(
				Type.Boolean({ description: "Return raw body without HTML stripping" }),
			),
			timeoutMs: Type.Optional(Type.Number({ default: DEFAULT_TIMEOUT_MS })),
		}),
		async execute(_toolCallId, params, signal) {
			const url = new URL(params.url);
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				throw new Error(`Unsupported protocol: ${url.protocol}`);
			}

			const headers = new Headers(params.headers ?? {});
			if (!headers.has("user-agent")) headers.set("user-agent", FIREFOX_UA);
			if (!headers.has("accept")) headers.set("accept", DEFAULT_ACCEPT);
			if (!headers.has("accept-language"))
				headers.set("accept-language", "en-US,en;q=0.5");

			const controller = new AbortController();
			const onAbort = () => controller.abort();
			signal?.addEventListener("abort", onAbort);
			const timer = setTimeout(
				() => controller.abort(new Error("fetch timeout")),
				params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			);

			try {
				const res = await fetch(url, {
					method: params.method ?? "GET",
					headers,
					body: params.body,
					signal: controller.signal,
					redirect: "follow",
				});

				const buf = await res.arrayBuffer();
				const truncated = buf.byteLength > MAX_BYTES;
				const slice = truncated ? buf.slice(0, MAX_BYTES) : buf;
				const ct = res.headers.get("content-type") ?? "";
				const charset = parseCharset(ct);
				const text = decodeBuffer(slice, charset);
				const isHtml = ct.includes("html");
				const body = !params.raw && isHtml ? htmlToText(text) : text;

				const header = [
					`HTTP ${res.status} ${res.statusText}`,
					`Content-Type: ${ct}`,
					`Charset: ${charset}`,
				];

				const bodyBytes = Buffer.byteLength(body, "utf8");
				const lineCount = body.length ? body.split("\n").length : 0;
				const shouldSpill =
					body.length > 0 &&
					(bodyBytes > INLINE_MAX_BYTES || lineCount > INLINE_MAX_LINES);

				const baseDetails: FetchToolDetails = {
					url: res.url,
					status: res.status,
					contentType: ct,
					charset,
					bytes: buf.byteLength,
					truncated,
					lines: lineCount,
				};

				if (!shouldSpill) {
					return {
						content: [
							{
								type: "text",
								text: [
									...header,
									`Length: ${buf.byteLength}${truncated ? " (truncated to 1MB)" : ""}`,
									"",
									body,
								].join("\n"),
							},
						],
						details: { ...baseDetails, spilled: false },
					};
				}

				const ext = pickExtension(ct, params.raw ?? false, isHtml);
				const file = spillToFile(res.url, body, ext);

				return {
					content: [
						{
							type: "text",
							text: [
								...header,
								`Length: ${buf.byteLength}${truncated ? " (truncated to 1MB)" : ""}`,
								`Body: ${formatSize(bodyBytes)} across ${lineCount} lines — written to file (too large to inline)`,
								`Saved-To: ${file}`,
								"",
								"Read slices of this file with the read tool (offset/limit) or grep it; do not read the whole file unless you must.",
								"",
								`----- preview (first ${PREVIEW_LINES} lines) -----`,
								buildPreview(body),
							].join("\n"),
						},
					],
					details: { ...baseDetails, spilled: true, file },
				};
			} finally {
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
			}
		},

		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("fetch "));
			const method = args.method ?? "GET";
			if (method !== "GET") {
				text += theme.fg("warning", `${method} `);
			}
			text += theme.fg("accent", args.url ?? "");
			if (args.raw) {
				text += theme.fg("dim", " (raw)");
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme, context) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Fetching..."), 0, 0);
			}

			const details = result.details as FetchToolDetails | undefined;
			const content = result.content[0];
			const fullText = content?.type === "text" ? content.text : "";

			if (context.isError) {
				const firstLine = fullText.split("\n")[0] || "fetch failed";
				return new Text(theme.fg("error", firstLine), 0, 0);
			}

			const status = details?.status;
			const statusStyled =
				status === undefined
					? theme.fg("muted", "HTTP ?")
					: status >= 200 && status < 300
						? theme.fg("success", `HTTP ${status}`)
						: status >= 300 && status < 400
							? theme.fg("warning", `HTTP ${status}`)
							: theme.fg("error", `HTTP ${status}`);

			const sep = theme.fg("dim", " · ");
			const parts: string[] = [statusStyled];
			if (details?.contentType) {
				parts.push(theme.fg("muted", details.contentType.split(";")[0].trim()));
			}
			if (typeof details?.bytes === "number") {
				let sizeText = formatSize(details.bytes);
				if (details.truncated) sizeText += " (truncated)";
				parts.push(theme.fg("dim", sizeText));
			}
			if (details?.spilled) {
				parts.push(theme.fg("warning", "→ file"));
			}

			let text = parts.join(sep);

			if (!expanded) {
				const lineCount = details?.lines ?? (fullText ? fullText.split("\n").length : 0);
				if (lineCount > 0) {
					text += sep + theme.fg("dim", `${lineCount} lines`);
				}
				text += " " + theme.fg("dim", `(${keyHint("app.tools.expand", "to expand")})`);
				return new Text(text, 0, 0);
			}

			if (fullText) {
				for (const line of fullText.split("\n")) {
					text += `\n${theme.fg("toolOutput", line)}`;
				}
			}
			return new Text(text, 0, 0);
		},
	});
}
