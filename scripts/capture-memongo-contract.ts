import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue }

type OpenApiOperation = {
	parameters?: Array<{
		in?: string
		name?: string
	}>
	requestBody?: {
		content?: {
			"application/json"?: {
				schema?: JsonValue
			}
		}
	}
	responses?: Record<string, JsonValue>
	summary?: string
}

type OpenApiDocument = {
	openapi: string
	info: {
		version: string
	}
	paths: Record<string, Record<string, OpenApiOperation>>
}

const HTTP_METHODS = new Set(["delete", "get", "patch", "post", "put"])

function isOpenApiDocument(value: unknown): value is OpenApiDocument {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false
	}
	const document = value as Partial<OpenApiDocument>
	return (
		typeof document.openapi === "string" &&
		typeof document.info?.version === "string" &&
		!!document.paths &&
		typeof document.paths === "object" &&
		!Array.isArray(document.paths)
	)
}

function canonicalize(value: JsonValue): JsonValue {
	if (Array.isArray(value)) {
		return value.map(canonicalize)
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonicalize(value[key])]),
		)
	}
	return value
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex")
}

function resolveBaseUrl(env: NodeJS.ProcessEnv): {
	baseUrl: URL
	loopback: boolean
} {
	const configured = env.MEMONGO_API_URL?.trim()
	if (!configured) {
		throw new Error("MEMONGO_API_URL is required")
	}
	const baseUrl = new URL(configured)
	if (baseUrl.username || baseUrl.password) {
		throw new Error("MEMONGO_API_URL must not contain credentials")
	}
	const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
		baseUrl.hostname,
	)
	if (
		baseUrl.protocol !== "https:" &&
		!(baseUrl.protocol === "http:" && loopback)
	) {
		throw new Error(
			"Refusing insecure Memongo endpoint: HTTP is allowed only on loopback",
		)
	}
	return { baseUrl, loopback }
}

async function readJson(
	baseUrl: URL,
	route: string,
): Promise<{
	body: unknown
	raw: string
	status: number
}> {
	const response = await fetch(new URL(route, baseUrl), {
		headers: { accept: "application/json" },
		method: "GET",
		redirect: "manual",
		signal: AbortSignal.timeout(10_000),
	})
	if (response.status >= 300 && response.status < 400) {
		throw new Error(`${route} redirected; redirects are not accepted`)
	}
	const raw = await response.text()
	let body: unknown
	try {
		body = JSON.parse(raw)
	} catch {
		throw new Error(`${route} returned malformed JSON`)
	}
	return { body, raw, status: response.status }
}

function routeManifest(document: OpenApiDocument) {
	return Object.entries(document.paths).flatMap(([route, pathItem]) =>
		Object.entries(pathItem)
			.filter(([method]) => HTTP_METHODS.has(method.toLowerCase()))
			.map(([method, operation]) => {
				const parameters = Array.isArray(operation.parameters)
					? operation.parameters
					: []
				return {
					method: method.toUpperCase(),
					path: route,
					summary: operation.summary ?? "",
					idempotencyHeader: parameters.some(
						(parameter) =>
							parameter.in === "header" &&
							parameter.name?.toLowerCase() === "idempotency-key",
					),
					responseStatuses: Object.keys(operation.responses ?? {}).sort(),
				}
			}),
	)
}

async function writeNewJson(filePath: string, value: unknown): Promise<void> {
	if (existsSync(filePath)) {
		throw new Error(
			`Refusing to overwrite existing contract evidence: ${filePath}`,
		)
	}
	await writeFile(filePath, `${JSON.stringify(value, null, "\t")}\n`, "utf8")
}

async function main(): Promise<void> {
	const { baseUrl, loopback } = resolveBaseUrl(process.env)
	const [health, ready, openApi] = await Promise.all([
		readJson(baseUrl, "/health"),
		readJson(baseUrl, "/ready"),
		readJson(baseUrl, "/openapi.json"),
	])
	if (!isOpenApiDocument(openApi.body)) {
		throw new Error("/openapi.json did not match the minimum OpenAPI shape")
	}

	const canonicalDocument = canonicalize(openApi.body as unknown as JsonValue)
	const canonicalJson = JSON.stringify(canonicalDocument)
	const outputDir = path.resolve(
		process.cwd(),
		"docs",
		"contracts",
		"memongo",
		openApi.body.info.version,
	)
	await mkdir(outputDir, { recursive: true })

	await writeNewJson(path.join(outputDir, "openapi.json"), canonicalDocument)
	await writeNewJson(path.join(outputDir, "capture.json"), {
		schemaVersion: 1,
		capturedAt: new Date().toISOString(),
		source: "configured Memongo endpoint",
		transport: {
			protocol: baseUrl.protocol,
			loopback,
			redirectPolicy: "manual-reject",
		},
		health: {
			status: health.status,
			ok:
				!!health.body &&
				typeof health.body === "object" &&
				(health.body as { ok?: unknown }).ok === true,
		},
		readiness: {
			status: ready.status,
			ok:
				!!ready.body &&
				typeof ready.body === "object" &&
				(ready.body as { ok?: unknown }).ok === true,
		},
		openapi: {
			status: openApi.status,
			format: openApi.body.openapi,
			version: openApi.body.info.version,
			rawSha256: sha256(openApi.raw),
			canonicalSha256: sha256(canonicalJson),
			pathCount: Object.keys(openApi.body.paths).length,
		},
		routes: routeManifest(openApi.body),
	})

	console.log(
		`Captured Memongo ${openApi.body.info.version} read-only contract evidence in ${path.relative(process.cwd(), outputDir)}`,
	)
}

await main()
