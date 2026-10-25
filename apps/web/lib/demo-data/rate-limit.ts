// Ticket 351: the in-Worker limit on anonymous demo traffic (D28). Counts are
// per Cloudflare location and approximate, so a few excess requests can pass.
// Off Workers there is no binding and nothing is limited; the binding ships in
// wrangler.jsonc, so no dashboard rule has to match it.

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { proxyError } from "./proxy-errors.js"

export type RateLimiter = {
	limit(options: { key: string }): Promise<{ success: boolean }>
}

export type RateLimitBinding = "DEMO_READ_LIMITER" | "DEMO_ANSWER_LIMITER"

declare global {
	interface CloudflareEnv {
		DEMO_READ_LIMITER?: RateLimiter
		DEMO_ANSWER_LIMITER?: RateLimiter
	}
}

const onWorkers = (): boolean =>
	globalThis.navigator?.userAgent === "Cloudflare-Workers"

export function limiterBinding(
	name: RateLimitBinding,
): RateLimiter | undefined {
	if (!onWorkers()) return undefined
	return getCloudflareContext().env[name]
}

/** Refuses a client over its limit before the caller does any work; `null`
 * means the request may proceed. An anonymous visitor has no identity but
 * the address the edge reports, so the address is the key. */
export async function limitByClient(
	request: Request,
	limiter: RateLimiter | undefined,
	message: string,
): Promise<Response | null> {
	if (!limiter) return null
	const key = request.headers.get("cf-connecting-ip")?.trim() || "unknown"
	const { success } = await limiter.limit({ key })
	if (success) return null
	const refusal = proxyError(429, "RATE_LIMITED", message)
	refusal.headers.set("retry-after", "60")
	refusal.headers.set("cache-control", "no-store")
	return refusal
}
