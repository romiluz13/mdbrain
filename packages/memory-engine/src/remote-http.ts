import {
	type SsrFPolicy,
	defaultSsrfPolicy,
	assertAllowedHostOrIp,
	assertPublicHostname,
	isPrivateIpAddress,
	isPrivateNetworkAllowedByPolicy,
} from "@mdbrain/lib"

export function buildRemoteBaseUrlPolicy(
	baseUrl: string,
): SsrFPolicy | undefined {
	const trimmed = baseUrl.trim()
	if (!trimmed) {
		return undefined
	}
	try {
		const parsed = new URL(trimmed)
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return undefined
		}
		const hostname = parsed.hostname
		// Local providers (e.g. Ollama at http://127.0.0.1:11434) intentionally
		// use private network addresses. Explicitly opt in to private network
		// access so the SSRF guard doesn't block legitimate local inference.
		const isLocalhost =
			hostname === "localhost" ||
			hostname === "127.0.0.1" ||
			hostname === "::1" ||
			isPrivateIpAddress(hostname)
		return {
			isAllowed: (url: string) => new URL(url).hostname === hostname,
			...(isLocalhost ? { allowPrivateNetwork: true } : {}),
		}
	} catch {
		return undefined
	}
}

export async function withRemoteHttpResponse<T>(params: {
	url: string
	init?: RequestInit
	ssrfPolicy?: SsrFPolicy
	auditContext?: string
	onResponse: (response: Response) => Promise<T>
}): Promise<T> {
	const policy = params.ssrfPolicy ?? defaultSsrfPolicy
	const isAllowed = policy.isAllowed ?? (() => true)
	if (!isAllowed(params.url)) {
		throw new Error(`SSRF guard blocked request to ${params.url}`)
	}

	// IP-range + DNS-rebinding protection: check the resolved hostname against
	// private/internal IP ranges and blocked hostnames. This runs AFTER the
	// isAllowed hostname check, so the per-provider hostname pinning still
	// applies. When allowPrivateNetwork is true (e.g. Ollama on localhost),
	// assertAllowedHostOrIp is a no-op.
	let parsedUrl: URL
	try {
		parsedUrl = new URL(params.url)
	} catch {
		throw new Error(`SSRF guard: invalid URL ${params.url}`)
	}
	assertAllowedHostOrIp(parsedUrl.hostname, policy)
	// DNS rebinding check: only when the hostname is NOT already a literal IP
	// address (literal IPs were already checked by assertAllowedHostOrIp).
	const isLiteralIp =
		isPrivateIpAddress(parsedUrl.hostname) ||
		/^\d{1,3}(\.\d{1,3}){3}$/.test(parsedUrl.hostname) ||
		parsedUrl.hostname.includes(":")
	if (!isLiteralIp && !isPrivateNetworkAllowedByPolicy(policy)) {
		await assertPublicHostname(parsedUrl.hostname)
	}

	const response = await fetch(params.url, params.init)
	return await params.onResponse(response)
}
