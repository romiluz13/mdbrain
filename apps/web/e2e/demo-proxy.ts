// Serves /api/demo/v1/** from the fixture upstream, through the real proxy
// handler, and records every response the page receives so a test can compare
// what the screen shows with what the proxy returned.
import type { Page } from "@playwright/test"
import { handleDemoRead } from "../lib/demo-data/proxy.js"
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

export type ProxyOptions = {
	/** Answer a request instead of the proxy (an outage, an empty run), or hold
	 * it by awaiting before returning undefined. */
	override?: (url: URL) => Response | undefined | Promise<Response | undefined>
	/** Rewrite the JSON body the proxy served (a source with no timestamp). */
	rewrite?: (url: URL, body: unknown) => unknown
	/** Pad the fixture with linked copies up to this many pages (stress runs). */
	padTo?: number
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
	if (!LIVE) {
		const upstream = createDemoUpstream({ padTo: options.padTo })
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
					upstream.fetch,
				))
			const text = await served.text()
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
