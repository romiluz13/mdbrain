import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

type CapturedRequest = {
	pathname: string
	body: Record<string, unknown>
	headers: Record<string, string>
}

async function interceptMemoryApi(page: Page): Promise<CapturedRequest[]> {
	const requests: CapturedRequest[] = []

	await page.route("**/v1/**", async (route) => {
		const request = route.request()
		const pathname = new URL(request.url()).pathname
		requests.push({
			pathname,
			body: request.postDataJSON() as Record<string, unknown>,
			headers: request.headers(),
		})

		const json =
			pathname === "/v1/add"
				? { ok: true, eventId: "event-1", chunkCreated: false }
				: pathname === "/v1/profile"
					? { profile: [] }
					: { results: [] }
		await route.fulfill({ status: 200, json })
	})

	return requests
}

async function openConsole(page: Page) {
	await page.goto("/console")
}

const memoryTabs = [
	{ tab: "Search", run: "Run search" },
	{ tab: "KB", run: "Run kb" },
	{ tab: "Profile", run: "Run profile" },
	{ tab: "Write", run: "Run write" },
] as const

test("omits a blank memory scope tuple and keeps session fields endpoint-specific", async ({
	page,
}) => {
	const requests = await interceptMemoryApi(page)
	await openConsole(page)

	for (const [index, { tab, run }] of memoryTabs.entries()) {
		await page.getByRole("button", { name: tab, exact: true }).click()
		await page.getByRole("button", { name: run }).click()
		await expect.poll(() => requests.length).toBe(index + 1)
	}

	for (const request of requests) {
		expect(request.body).not.toHaveProperty("scope")
		expect(request.body).not.toHaveProperty("scopeRef")
	}
	expect(requests[0]?.body).toMatchObject({ sessionKey: "default" })
	expect(requests[0]?.body).not.toHaveProperty("sessionId")
	expect(requests[1]?.body).not.toHaveProperty("sessionKey")
	expect(requests[1]?.body).not.toHaveProperty("sessionId")
	expect(requests[2]?.body).not.toHaveProperty("sessionKey")
	expect(requests[2]?.body).not.toHaveProperty("sessionId")
	expect(requests[3]?.body).toMatchObject({ sessionId: "default" })
	expect(requests[3]?.body).not.toHaveProperty("sessionKey")
})

test("forwards one explicit memory scope tuple with endpoint-specific session fields", async ({
	page,
}) => {
	const requests = await interceptMemoryApi(page)
	await openConsole(page)

	await page.getByRole("button", { name: "Search", exact: true }).click()
	await page
		.getByRole("combobox", { name: "Scope", exact: true })
		.selectOption("workspace")
	await page.getByLabel("Scope ref", { exact: true }).fill("  project-x  ")
	await page.getByLabel("Session key (filter)").fill("search-session")
	await page.getByRole("button", { name: "Run search" }).click()
	await expect.poll(() => requests.length).toBe(1)
	expect(requests[0]).toMatchObject({
		pathname: "/v1/search",
		body: {
			scope: "workspace",
			scopeRef: "project-x",
			sessionKey: "search-session",
		},
	})
	expect(requests[0]?.body).not.toHaveProperty("sessionId")

	await page.getByRole("button", { name: "KB", exact: true }).click()
	await page.getByRole("button", { name: "Run kb" }).click()
	await expect.poll(() => requests.length).toBe(2)
	expect(requests[1]).toMatchObject({
		pathname: "/v1/search-kb",
		body: { scope: "workspace", scopeRef: "project-x" },
	})
	expect(requests[1]?.body).not.toHaveProperty("sessionKey")
	expect(requests[1]?.body).not.toHaveProperty("sessionId")

	await page.getByRole("button", { name: "Profile", exact: true }).click()
	await page.getByRole("button", { name: "Run profile" }).click()
	await expect.poll(() => requests.length).toBe(3)
	expect(requests[2]).toMatchObject({
		pathname: "/v1/profile",
		body: { scope: "workspace", scopeRef: "project-x" },
	})
	expect(requests[2]?.body).not.toHaveProperty("sessionKey")
	expect(requests[2]?.body).not.toHaveProperty("sessionId")

	await page.getByRole("button", { name: "Write", exact: true }).click()
	await page.getByLabel("Session ID (attribution)").fill("write-session")
	await page.getByRole("button", { name: "Run write" }).click()
	await expect.poll(() => requests.length).toBe(4)
	expect(requests[3]).toMatchObject({
		pathname: "/v1/add",
		body: {
			scope: "workspace",
			scopeRef: "project-x",
			sessionId: "write-session",
		},
	})
	expect(requests[3]?.body).not.toHaveProperty("sessionKey")
	expect(requests[3]?.headers["idempotency-key"]).toBeTruthy()
})

test("blocks both half-filled scope tuple states on every memory tab", async ({
	page,
}) => {
	const requests = await interceptMemoryApi(page)
	await openConsole(page)

	await page.getByRole("button", { name: "Search", exact: true }).click()
	await page
		.getByRole("combobox", { name: "Scope", exact: true })
		.selectOption("workspace")
	for (const { tab, run } of memoryTabs) {
		await page.getByRole("button", { name: tab, exact: true }).click()
		await page.getByRole("button", { name: run }).click()
		await expect(
			page.getByRole("heading", { name: "Invalid memory scope" }),
		).toBeVisible()
	}

	await page
		.getByRole("combobox", { name: "Scope", exact: true })
		.selectOption("")
	await page.getByLabel("Scope ref", { exact: true }).fill("project-x")
	for (const { tab, run } of memoryTabs) {
		await page.getByRole("button", { name: tab, exact: true }).click()
		await page.getByRole("button", { name: run }).click()
		await expect(
			page.getByText(
				"Set both Scope and Scope ref, or clear both. A half-set scope is not a valid memory identity.",
			),
		).toBeVisible()
	}

	expect(requests).toHaveLength(0)
})

test("uses a 16-byte opaque idempotency key when randomUUID is unavailable", async ({
	page,
}) => {
	const pageErrors: string[] = []
	page.on("pageerror", (error) => pageErrors.push(error.message))
	await page.addInitScript(() => {
		Object.defineProperty(Crypto.prototype, "randomUUID", {
			configurable: true,
			value: undefined,
		})
	})
	const requests = await interceptMemoryApi(page)
	await openConsole(page)

	await page.getByRole("button", { name: "Write", exact: true }).click()
	await page.getByRole("button", { name: "Run write" }).click()
	await expect(
		page.getByRole("heading", { name: "Memory write", exact: true }),
	).toBeVisible({ timeout: 5_000 })
	await expect.poll(() => requests.length).toBe(1)

	expect(requests[0]?.pathname).toBe("/v1/add")
	expect(requests[0]?.headers["idempotency-key"]).toMatch(/^[0-9a-f]{32}$/)
	expect(pageErrors).not.toContain("crypto.randomUUID is not a function")
})
