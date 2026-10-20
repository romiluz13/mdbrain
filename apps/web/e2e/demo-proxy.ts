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

export async function installDemoProxy(
	page: Page,
	override?: (url: URL) => Response | undefined,
) {
	const responses: ProxyResponse[] = []
	page.on("response", async (response) => {
		const url = new URL(response.url())
		if (!url.pathname.startsWith("/api/demo/v1/")) {
			return
		}
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
	})
	if (!LIVE) {
		const upstream = createDemoUpstream()
		await page.route("**/api/demo/v1/**", async (route) => {
			const request = route.request()
			const url = new URL(request.url())
			const forced = override?.(url)
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
			await route.fulfill({
				status: served.status,
				headers: { "content-type": "application/json" },
				body: await served.text(),
			})
		})
	}
	return {
		responses,
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
