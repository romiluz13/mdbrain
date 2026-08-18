export type OverviewState = {
	health?: { ok?: boolean; service?: string }
	openApiPathCount?: number
	openApiOperationCount?: number
	lastRefreshAt?: string
}

const HTTP_OPERATION_METHODS = new Set([
	"get",
	"post",
	"put",
	"patch",
	"delete",
])

async function fetchJson(
	baseUrl: string,
	path: string,
	headers: Record<string, string>,
	fetcher: typeof fetch,
): Promise<unknown> {
	const response = await fetcher(`${baseUrl.replace(/\/$/, "")}${path}`, {
		headers,
	})
	const text = await response.text()
	if (!response.ok) {
		throw new Error(`${path} returned HTTP ${response.status}\n${text}`)
	}
	return text ? JSON.parse(text) : null
}

export async function loadOverview(
	baseUrl: string,
	headers: Record<string, string>,
	fetcher: typeof fetch = fetch,
): Promise<OverviewState> {
	const [health, openApi] = await Promise.all([
		fetchJson(baseUrl, "/health", headers, fetcher),
		fetchJson(baseUrl, "/openapi.json", headers, fetcher),
	])
	const openApiPaths =
		(openApi as { paths?: Record<string, Record<string, unknown>> }).paths ?? {}

	return {
		health: health as OverviewState["health"],
		openApiPathCount: Object.keys(openApiPaths).length,
		openApiOperationCount: Object.values(openApiPaths).reduce(
			(count, operations) =>
				count +
				Object.keys(operations).filter((method) =>
					HTTP_OPERATION_METHODS.has(method),
				).length,
			0,
		),
		lastRefreshAt: new Date().toISOString(),
	}
}
