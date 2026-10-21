// Serves /api/demo/v1/** from the fixture upstream, through the real proxy
// handler, and records every response the page receives so a test can compare
// what the screen shows with what the proxy returned.
import { gzipSync } from "node:zlib"
import type { Page } from "@playwright/test"
import { handleDemoRead } from "../lib/demo-data/proxy.js"
import { createRecordedUpstream, readRecording } from "./demo-recorded.js"
import { createDemoUpstream, FIXTURE_ENV } from "./demo-upstream.js"

export type ProxyResponse = {
	url: URL
	status: number
	body: unknown
	requestHeaders: Record<string, string>
}

/** Set DEMO_E2E_LIVE=1 to skip the fixture and let the page read the dev
 * server's own /api/demo route, which uses MDBRAIN_DEMO_* from its environment. */
export const LIVE = process.env.DEMO_E2E_LIVE === "1"

/** DEMO_REPLAY=<recording.json> serves a recording made by the recorder (see
 * demo-record.e2e.ts) instead of the generated fixture. */
export const REPLAY = process.env.DEMO_REPLAY

/** The data is the generated fixture: not a live stack and not a recording, so
 * a test may assert what the generator plants. */
export const GENERATED = !LIVE && REPLAY === undefined

/** How long a test waits for a read that is slow on the live stack: an event
 * cite is a Memongo recall of 5 to 7 s, and the first page list is large. The
 * fixture answers at once, so it keeps Playwright's default wait. */
export const SLOW_READ = LIVE ? { timeout: 30_000 } : {}

export type ProxyOptions = {
	/** Answer a request instead of the proxy (an outage, an empty run), or hold
	 * it by awaiting before returning undefined. */
	override?: (url: URL) => Response | undefined | Promise<Response | undefined>
	/** Rewrite the JSON body the proxy served (a source with no timestamp). */
	rewrite?: (url: URL, body: unknown) => unknown
	/** Pad the fixture with linked copies up to this many pages (stress runs). */
	padTo?: number
	/** "none" serves a run with no contradiction recorded yet, as a seeded slot is
	 * before its agent run. */
	contradiction?: "recorded" | "none"
	/** Model the phone's link for a performance run: each read waits `latencyMs`,
	 * then its gzipped body takes its turn on one shared downlink. The fixture
	 * is fulfilled inside the browser, so the CDP network throttle never sees
	 * these bytes. */
	link?: { latencyMs: number; bytesPerSecond: number }
}

export async function installDemoProxy(page: Page, options: ProxyOptions = {}) {
	const responses: ProxyResponse[] = []
	const pending = new Set<Promise<void>>()
	page.on("response", (response) => {
		const url = new URL(response.url())
		if (!url.pathname.startsWith("/api/demo/v1/")) {
			return
		}
		const read = (async () => {
			let body: unknown = null
			try {
				body = await response.json()
			} catch {
				body = null
			}
			responses.push({
				url,
				status: response.status(),
				body,
				requestHeaders: response.request().headers(),
			})
		})()
		pending.add(read)
		void read.finally(() => pending.delete(read))
	})
	const transfer = { raw: 0, wire: 0 }
	let linkFreeAt = 0
	if (!LIVE) {
		const upstreamFetch = REPLAY
			? createRecordedUpstream(readRecording(REPLAY))
			: createDemoUpstream({
					padTo: options.padTo,
					contradiction: options.contradiction,
				}).fetch
		await page.route("**/api/demo/v1/**", async (route) => {
			const request = route.request()
			const url = new URL(request.url())
			const forced = await options.override?.(url)
			const served =
				forced ??
				(await handleDemoRead(
					new Request(request.url(), {
						method: request.method(),
						headers: request.headers(),
					}),
					FIXTURE_ENV,
					upstreamFetch,
				))
			const text = await served.text()
			if (options.link) {
				const wire = gzipSync(text).length
				transfer.raw += Buffer.byteLength(text)
				transfer.wire += wire
				await new Promise((resolve) =>
					setTimeout(resolve, options.link?.latencyMs),
				)
				const now = Date.now()
				linkFreeAt =
					Math.max(now, linkFreeAt) +
					(wire / options.link.bytesPerSecond) * 1000
				await new Promise((resolve) => setTimeout(resolve, linkFreeAt - now))
			}
			await route.fulfill({
				status: served.status,
				headers: { "content-type": "application/json" },
				body:
					options.rewrite && served.ok
						? JSON.stringify(options.rewrite(url, JSON.parse(text)))
						: text,
			})
		})
	}
	return {
		responses,
		/** Bytes the proxy served in a link-modelled run, before and after gzip. */
		transfer,
		/** Waits until every response seen so far has been parsed and logged. */
		async flush(): Promise<void> {
			await Promise.all([...pending])
		},
		/** The latest response to a path, optionally narrowed by a query value. */
		latest(
			path: string,
			query?: Record<string, string>,
		): ProxyResponse | undefined {
			return [...responses]
				.reverse()
				.find(
					(entry) =>
						entry.url.pathname === `/api/demo/v1/${path}` &&
						Object.entries(query ?? {}).every(
							([key, value]) => entry.url.searchParams.get(key) === value,
						),
				)
		},
	}
}
