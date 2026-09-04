// Contract parity suite (REV-07): pins the three public surfaces that
// describe the same wiki contract — the runtime route handlers
// (routes/v1.ts), the OpenAPI document (openapi-spec.ts), and the MCP tool
// schemas (apps/mcp/src/server.ts toolList) — so none can silently drift
// below what the runtime actually enforces.
//
// Rule being enforced: NO public surface may accept a request the runtime
// rejects (looser-than-runtime is a bug), and the runtime validation sets
// are the single source of truth (imported here, never duplicated).

import { describe, expect, it } from "vitest"
import { createApp } from "./app.js"
import { openApiSpec } from "./openapi-spec.js"
import {
	WIKI_RESERVED_SLUG_SEGMENTS,
	WIKI_VALID_KINDS,
	WIKI_VALID_SCOPES,
	WIKI_VALID_TRUST_TIERS,
} from "./routes/v1.js"
// Cross-app import is deliberate: the MCP tool schemas are the third surface
// of the same contract and must be pinned in the same place. The specifier
// sits outside this package's rootDir, so tsc cannot follow it (the stricter
// expect-error form trips the unused-directive check for program-level
// diagnostics); vitest resolves it against the workspace source at test time.
// eslint-disable-next-line
// @ts-ignore -- see comment above
import { toolList } from "../../mcp/src/server.js"

type Json = Record<string, unknown>

type SpecOperation = {
	requestBody?: { required?: boolean; content?: Json }
	responses?: Record<string, Json>
	security?: unknown[]
	parameters?: Array<{ name: string; in: string; schema?: Json }>
	[key: string]: unknown
}

type SpecDocument = {
	paths: Record<string, Record<string, SpecOperation | undefined>>
	components: { securitySchemes?: Json; schemas?: Json }
	security?: Array<Json>
}

const spec = openApiSpec as unknown as SpecDocument

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const

function specOperation(path: string, method: string): SpecOperation {
	const item = spec.paths[path]
	const op = item?.[method]
	if (!op) {
		throw new Error(`spec is missing ${method.toUpperCase()} ${path}`)
	}
	return op
}

function requestBodySchema(path: string, method: string): Json {
	const content = specOperation(path, method).requestBody?.content as
		| { "application/json"?: { schema?: Json } }
		| undefined
	const schema = content?.["application/json"]?.schema
	if (!schema) {
		throw new Error(`spec ${method.toUpperCase()} ${path} lacks a JSON schema`)
	}
	return schema
}

function queryParameterNames(path: string, method: string): string[] {
	return (specOperation(path, method).parameters ?? [])
		.filter((p) => p.in === "query")
		.map((p) => p.name)
}

function mcpTool(name: string) {
	const tool = toolList.find((t) => t.name === name)
	if (!tool) {
		throw new Error(`MCP toolList is missing ${name}`)
	}
	return tool as {
		inputSchema: {
			required?: string[]
			properties: Record<string, Json | undefined>
		}
	}
}

describe("route ↔ OpenAPI parity", () => {
	it("documents every registered route path as a spec path (and vice versa)", () => {
		const app = createApp()
		const normalizeRoute = (routePath: string): string =>
			routePath.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\/\*$/, "/{slug}")
		const routeKeys = new Set<string>()
		for (const route of app.routes) {
			if (route.method === "ALL" || route.method === "USE") continue
			routeKeys.add(`${route.method} ${normalizeRoute(route.path)}`)
		}
		const specKeys = new Set<string>()
		for (const [path, item] of Object.entries(spec.paths)) {
			for (const method of HTTP_METHODS) {
				if (item[method]) specKeys.add(`${method.toUpperCase()} ${path}`)
			}
		}
		const undocumentedRoutes = [...routeKeys].filter((k) => !specKeys.has(k))
		const phantomSpecPaths = [...specKeys].filter((k) => !routeKeys.has(k))
		expect(undocumentedRoutes).toEqual([])
		expect(phantomSpecPaths).toEqual([])
	})

	it("marks every request body as required (empty-body calls fail at runtime)", () => {
		for (const [path, item] of Object.entries(spec.paths)) {
			for (const method of HTTP_METHODS) {
				const op = item[method]
				if (!op?.requestBody) continue
				expect(
					op.requestBody.required,
					`${method.toUpperCase()} ${path} requestBody.required`,
				).toBe(true)
			}
		}
	})

	it("documents 429 with Retry-After on every /v1 operation, and 415 on body-carrying ones", () => {
		for (const [path, item] of Object.entries(spec.paths)) {
			for (const method of HTTP_METHODS) {
				const op = item[method]
				if (!op) continue
				if (path.startsWith("/v1/")) {
					const tooMany = op.responses?.["429"] as
						| { headers?: Json; content?: Json }
						| undefined
					expect(
						tooMany?.headers?.["Retry-After"],
						`${method.toUpperCase()} ${path} 429 Retry-After header`,
					).toBeDefined()
					expect(
						(tooMany?.content?.["application/json"] as Json | undefined)
							?.schema,
					).toEqual({ $ref: "#/components/schemas/ApiError" })
				}
				if (path.startsWith("/v1/") && op.requestBody && method !== "get") {
					const unsupported = op.responses?.["415"] as
						| { content?: Json }
						| undefined
					expect(
						(unsupported?.content?.["application/json"] as Json | undefined)
							?.schema,
						`${method.toUpperCase()} ${path} 415 ApiError ref`,
					).toEqual({ $ref: "#/components/schemas/ApiError" })
				}
			}
		}
	})

	it("requires bearer auth on /v1 operations and leaves readiness probes open", () => {
		expect(spec.components.securitySchemes).toHaveProperty("bearerAuth")
		expect(spec.security).toEqual([{ bearerAuth: [] }])
		for (const path of ["/health", "/ready", "/openapi.json"]) {
			expect(specOperation(path, "get").security).toEqual([])
		}
		for (const [path, item] of Object.entries(spec.paths)) {
			if (!path.startsWith("/v1/")) continue
			for (const method of HTTP_METHODS) {
				const op = item[method]
				if (!op) continue
				// No /v1 operation may opt out of the global bearer requirement.
				expect(op.security, `${method.toUpperCase()} ${path}`).toBeUndefined()
			}
		}
	})
})

describe("wiki contract matrix (runtime ↔ spec ↔ MCP)", () => {
	it("create: spec required list matches the runtime-validated fields", () => {
		const schema = requestBodySchema("/v1/wiki", "post")
		expect(schema.required).toEqual([
			"kind",
			"title",
			"slug",
			"summary",
			"scope",
			"scopeRef",
			"trustTier",
			"frontmatter",
		])
	})

	it("create: spec enums equal the runtime validation sets (single source of truth)", () => {
		const properties = requestBodySchema("/v1/wiki", "post")
			.properties as Record<string, Json | undefined>
		expect(properties.kind?.enum).toEqual([...WIKI_VALID_KINDS])
		expect(properties.scope?.enum).toEqual([...WIKI_VALID_SCOPES])
		expect(properties.trustTier?.enum).toEqual([...WIKI_VALID_TRUST_TIERS])
		const frontmatter = properties.frontmatter as
			| { required?: string[] }
			| undefined
		expect(frontmatter?.required).toContain("type")
	})

	it("create: reserved slug segments are documented on the slug field", () => {
		const properties = requestBodySchema("/v1/wiki", "post")
			.properties as Record<string, { description?: string } | undefined>
		const description = properties.slug?.description ?? ""
		for (const segment of WIKI_RESERVED_SLUG_SEGMENTS) {
			expect(description).toContain(segment)
		}
	})

	it("create: MCP wiki_apply schema is never looser than the runtime", () => {
		const tool = mcpTool("mdbrain_wiki_apply")
		expect(tool.inputSchema.required).toEqual(
			expect.arrayContaining([
				"kind",
				"title",
				"slug",
				"summary",
				"scope",
				"scopeRef",
				"trustTier",
				"frontmatter",
			]),
		)
		expect(tool.inputSchema.properties.kind?.enum).toEqual([
			...WIKI_VALID_KINDS,
		])
		expect(tool.inputSchema.properties.scope?.enum).toEqual([
			...WIKI_VALID_SCOPES,
		])
		expect(tool.inputSchema.properties.trustTier?.enum).toEqual([
			...WIKI_VALID_TRUST_TIERS,
		])
	})

	it("search: spec requires exactly what the runtime requires", () => {
		expect(requestBodySchema("/v1/wiki/search", "post").required).toEqual([
			"query",
			"scope",
			"scopeRef",
		])
	})

	it("search: MCP schema exposes the runtime filters and is not looser", () => {
		const tool = mcpTool("mdbrain_wiki_search")
		expect(tool.inputSchema.required).toEqual(
			expect.arrayContaining(["query", "scope", "scopeRef"]),
		)
		for (const filter of ["state", "privacyTier", "minScore"]) {
			expect(
				tool.inputSchema.properties[filter],
				`MCP wiki_search ${filter}`,
			).toBeDefined()
			const searchProperties = requestBodySchema("/v1/wiki/search", "post")
				.properties as Record<string, unknown> | undefined
			expect(
				searchProperties?.[filter],
				`spec wiki_search ${filter}`,
			).toBeDefined()
		}
	})

	it("get: spec and MCP expose format + transclude", () => {
		const formatParam = specOperation(
			"/v1/wiki/{slug}",
			"get",
		).parameters?.find((p) => p.name === "format")
		expect(formatParam?.schema?.enum).toEqual(["json", "markdown", "html"])
		expect(queryParameterNames("/v1/wiki/{slug}", "get")).toContain(
			"transclude",
		)
		const tool = mcpTool("mdbrain_wiki_get")
		expect(tool.inputSchema.properties.format?.enum).toEqual([
			"json",
			"markdown",
			"html",
		])
		expect(tool.inputSchema.properties.transclude).toBeDefined()
	})

	it("patch: documents expectedRevision, permissions and the 409 contract", () => {
		const properties = requestBodySchema("/v1/wiki/{slug}", "patch")
			.properties as Record<string, Json | undefined>
		expect(properties.expectedRevision).toBeDefined()
		expect(properties.permissions).toBeDefined()
		const responses = specOperation("/v1/wiki/{slug}", "patch").responses ?? {}
		expect(responses["409"]).toBeDefined()
		expect(responses["400"]).toBeDefined()
	})

	it("lint: spec exposes the kind and limit query params the route honors", () => {
		const params = queryParameterNames("/v1/wiki/lint", "get")
		expect(params).toContain("kind")
		expect(params).toContain("limit")
		const tool = mcpTool("mdbrain_wiki_lint")
		expect(tool.inputSchema.properties.kind).toBeDefined()
		expect(tool.inputSchema.properties.limit).toBeDefined()
	})

	it("okf-export: spec and MCP expose trustTier and returnContent", () => {
		const properties = requestBodySchema("/v1/wiki/okf-export", "post")
			.properties as Record<string, Json | undefined>
		expect(properties.trustTier?.enum).toEqual([...WIKI_VALID_TRUST_TIERS])
		expect(properties.returnContent).toBeDefined()
		const tool = mcpTool("mdbrain_wiki_export_okf")
		expect(tool.inputSchema.properties.trustTier).toBeDefined()
		expect(tool.inputSchema.properties.returnContent).toBeDefined()
	})

	it("okf-import: spec required list matches the runtime", () => {
		expect(requestBodySchema("/v1/wiki/okf-import", "post").required).toEqual([
			"bundleDir",
			"scope",
			"scopeRef",
			"trustTier",
			"okfBundleId",
		])
	})
})
