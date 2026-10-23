// A second line against online guessing of the presenter token: sign-in
// attempts counted per client address, in this process, and given back when
// one works. The first line is the edge rate limit (docs/platform/demo.md);
// this one is small on purpose and fails closed when a request names no
// address.

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

export const SIGN_IN_TRACKED_MAX = 4096

export function createSignInLimiter(deps: {
	now: () => Date
	max?: number
	windowMs?: number
	maxTracked?: number
}) {
	const max = deps.max ?? SIGN_IN_FAILURES_MAX
	const windowMs = deps.windowMs ?? SIGN_IN_WINDOW_MS
	const maxTracked = deps.maxTracked ?? SIGN_IN_TRACKED_MAX
	const attempts = new Map<string, number[]>()

	const liveOf = (address: string, at: number): number[] =>
		(attempts.get(address) ?? []).filter((time) => at - time < windowMs)

	// A client that rotates the header it is counted by adds an address per
	// request, so the map is swept only when it is full, and then loses its
	// oldest entry, in insertion order, if the sweep freed nothing.
	function makeRoom(at: number): void {
		if (attempts.size < maxTracked) return
		for (const address of [...attempts.keys()]) {
			const live = liveOf(address, at)
			if (live.length === 0) attempts.delete(address)
			else attempts.set(address, live)
		}
		const oldest = attempts.keys().next()
		if (attempts.size >= maxTracked && !oldest.done) {
			attempts.delete(oldest.value)
		}
	}

	return {
		/** Counts an attempt as it begins, so guesses made in parallel are
		 * counted before any of them is answered. */
		begin(address: string | undefined): "ok" | "no-address" | "limited" {
			if (address === undefined) return "no-address"
			const at = deps.now().getTime()
			const live = liveOf(address, at)
			if (live.length >= max) {
				attempts.set(address, live)
				return "limited"
			}
			if (!attempts.has(address)) makeRoom(at)
			attempts.set(address, [...live, at])
			return "ok"
		},
		/** Gives back the attempt that just worked. */
		succeed(address: string): void {
			const live = attempts.get(address)
			if (!live) return
			if (live.length <= 1) attempts.delete(address)
			else attempts.set(address, live.slice(0, -1))
		},
		retryAfterSeconds(address: string): number {
			const oldest = attempts.get(address)?.[0]
			if (oldest === undefined) return 0
			return Math.max(
				1,
				Math.ceil((oldest + windowMs - deps.now().getTime()) / 1000),
			)
		},
		size: () => attempts.size,
	}
}

export type SignInLimiter = ReturnType<typeof createSignInLimiter>
