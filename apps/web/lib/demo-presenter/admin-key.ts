// The presenter's review key is held by the web server and decides proposals
// for the leased slot. Before any presenter action the server asks the API
// what that key may do and serves presenter mode only for a key whose
// capabilities are exactly administer: a key that can also read, write or
// export (the API's own admin key, say) would hand a leaked environment far
// more than the review queue. Same shape as the read key check: a settled
// verdict is kept, a check that could not finish is not and never passes.

export type AdminKeyTarget = { apiBaseUrl: string; adminKey: string }

export type AdminKeyCheck = (
	target: AdminKeyTarget,
	fetchImpl: typeof fetch,
) => Promise<boolean>

const CHECK_TIMEOUT_MS = 5_000

type Verdict = "administer-only" | "refused" | "unknown"

async function askApi(
	target: AdminKeyTarget,
	fetchImpl: typeof fetch,
	timeoutMs: number,
): Promise<Verdict> {
	let body: unknown
	try {
		const response = await fetchImpl(
			new URL(`${target.apiBaseUrl}/v1/principal/self`),
			{
				method: "GET",
				headers: {
					authorization: `Bearer ${target.adminKey}`,
					accept: "application/json",
				},
				signal: AbortSignal.timeout(timeoutMs),
			},
		)
		if (!response.ok) return "unknown"
		body = await response.json()
	} catch {
		return "unknown"
	}
	const capabilities =
		typeof body === "object" && body !== null
			? (body as { capabilities?: unknown }).capabilities
			: undefined
	return Array.isArray(capabilities) &&
		capabilities.length === 1 &&
		capabilities[0] === "administer"
		? "administer-only"
		: "refused"
}

export function createAdminKeyCheck(
	options: { timeoutMs?: number } = {},
): AdminKeyCheck {
	const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS
	const settled = new Map<string, boolean>()
	const asking = new Map<string, Promise<boolean>>()
	return async (target, fetchImpl) => {
		const id = JSON.stringify([target.apiBaseUrl, target.adminKey])
		const known = settled.get(id)
		if (known !== undefined) return known
		const pending = asking.get(id)
		if (pending) return pending
		const check = askApi(target, fetchImpl, timeoutMs).then((verdict) => {
			if (verdict !== "unknown") settled.set(id, verdict === "administer-only")
			return verdict === "administer-only"
		})
		asking.set(id, check)
		try {
			return await check
		} finally {
			asking.delete(id)
		}
	}
}
