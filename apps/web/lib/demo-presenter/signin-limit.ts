// A second line against online guessing of the presenter token: failed
// sign-ins counted per client address, in this process. The first line is the
// edge rate limit (docs/platform/demo.md); this one is small on purpose and
// fails closed when a request names no address.

export const SIGN_IN_WINDOW_MS = 60_000
export const SIGN_IN_FAILURES_MAX = 10

/** The address the edge says the request came from. Only an edge that
 * overwrites these headers makes them trustworthy. */
export function clientAddress(headers: Headers): string | undefined {
	const edge = headers.get("cf-connecting-ip")?.trim()
	if (edge) return edge
	const hop = headers.get("x-forwarded-for")?.split(",")[0]?.trim()
	return hop || undefined
}

export function createSignInLimiter(deps: {
	now: () => Date
	max?: number
	windowMs?: number
}) {
	const max = deps.max ?? SIGN_IN_FAILURES_MAX
	const windowMs = deps.windowMs ?? SIGN_IN_WINDOW_MS
	const failures = new Map<string, number[]>()

	function prune(at: number): void {
		for (const [address, times] of failures) {
			const live = times.filter((time) => at - time < windowMs)
			if (live.length === 0) failures.delete(address)
			else failures.set(address, live)
		}
	}

	return {
		check(address: string | undefined): "ok" | "no-address" | "limited" {
			if (address === undefined) return "no-address"
			prune(deps.now().getTime())
			return (failures.get(address)?.length ?? 0) >= max ? "limited" : "ok"
		},
		fail(address: string): void {
			failures.set(address, [
				...(failures.get(address) ?? []),
				deps.now().getTime(),
			])
		},
		retryAfterSeconds(address: string): number {
			const oldest = failures.get(address)?.[0]
			if (oldest === undefined) return 0
			return Math.max(
				1,
				Math.ceil((oldest + windowMs - deps.now().getTime()) / 1000),
			)
		},
		size: () => failures.size,
	}
}

export type SignInLimiter = ReturnType<typeof createSignInLimiter>
