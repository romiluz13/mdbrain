import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { type FakeApi, installFakeApi } from "./workspace-fake-api"

// Network is mocked by ./workspace-fake-api. These tests show how the UI
// handles real-shaped responses; they do not show live backend behavior.

const KEY = "wk-secret-key-123"

type Identity = { scopeRef?: string; agentId?: string; apiKey?: string }
type Info = { project: { name: string } }

async function connect(page: Page, identity: Identity = {}) {
	await page.getByLabel("API base URL").fill("http://127.0.0.1:3847")
	await page.getByLabel("API key").fill(identity.apiKey ?? KEY)
	await page.getByLabel("Agent ID").fill(identity.agentId ?? "agent-a")
	await page.getByLabel("Scope", { exact: true }).selectOption("workspace")
	await page.getByLabel("Scope reference").fill(identity.scopeRef ?? "ref-a")
	await page.getByRole("button", { name: "Connect" }).click()
}

async function open(page: Page, identity?: Identity): Promise<FakeApi> {
	const api = installFakeApi(page)
	await page.goto("/workspace")
	await connect(page, identity)
	return api
}

async function shot(page: Page, name: string, info: Info) {
	const dir = process.env.WORKSPACE_SHOT_DIR
	if (dir) {
		await page.screenshot({
			path: `${dir}/${info.project.name}-${name}.png`,
			fullPage: true,
		})
	}
}

async function createPage(page: Page, slug: string, body: string) {
	await page.getByRole("button", { name: "New page" }).click()
	await page.getByLabel("Title").fill(slug)
	await page.getByLabel("Slug").fill(slug)
	await page.getByLabel("Kind").selectOption("concept")
	await page.getByLabel("Frontmatter type").fill("decision")
	await page.getByLabel("Summary").fill("Current decision")
	await page.getByLabel("Body").fill(body)
	await page.getByRole("button", { name: "Create page" }).click()
}

// The margin keeps essential fields visible; the rest sit behind "All fields".
const marginBox = (page: Page, label: string) =>
	page
		.getByLabel(label)
		.locator('xpath=ancestor::div[contains(@class,"margin")][1]')

async function openAllFields(page: Page, label: string) {
	const box = marginBox(page, label)
	await box.getByText(/^All fields/).click()
	return box
}

const alerts = (page: Page) =>
	page.locator('[role="alert"]:not(#__next-route-announcer__)')
const knowledge = (page: Page) => page.locator("#lane-knowledge")
const memory = (page: Page) => page.locator("#lane-memory")

async function seriousViolations(page: Page) {
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
		.analyze()
	return results.violations
		.filter((v) => v.impact === "serious" || v.impact === "critical")
		.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))
}

test("blocks an incomplete identity before any request is made", async ({
	page,
}) => {
	const api = installFakeApi(page)
	await page.goto("/workspace")
	await page.getByLabel("API base URL").fill("ftp://nope")
	await page.getByLabel("Agent ID").fill("agent-a")
	await page.getByLabel("Scope", { exact: true }).selectOption("workspace")
	await page.getByRole("button", { name: "Connect" }).click()

	await expect(page.getByText("Use an http:// or https:// URL.")).toBeVisible()
	await expect(
		page.getByText("Enter the scope reference that goes with the scope."),
	).toBeVisible()
	expect(api.log).toHaveLength(0)
	await expect(
		page.getByRole("heading", { name: "Knowledge pages" }),
	).toHaveCount(0)
})

test("creates, reads, edits and inspects history of a knowledge page", async ({
	page,
}, info) => {
	const api = await open(page)
	await expect(page.getByText("No pages in this scope yet")).toBeVisible()

	await createPage(page, "identity-rollout", "Use the edge adapter.")
	await expect(
		page.getByRole("heading", { name: "identity-rollout", level: 3 }),
	).toBeVisible()
	const margin = marginBox(page, "Page record fields")
	await expect(margin).toContainText("revision")
	await expect(margin).toContainText("identity-rollout")
	await expect(margin).toContainText("workspace/ref-a")
	await expect(margin.locator("dt", { hasText: "freshness" })).toBeHidden() // collapsed
	const all = await openAllFields(page, "Page record fields")
	await expect(all.locator("dt", { hasText: "freshness" })).toBeVisible()
	await expect(all).toContainText("trust tier")
	await expect(all).toContainText("valid to") // listed under "not reported"
	await expect(all).toContainText("not reported")
	const created = api.log.find(
		(r) => r.method === "POST" && r.path === "/v1/wiki",
	)
	expect(created?.body).toMatchObject({ scope: "workspace", scopeRef: "ref-a" })
	expect(created?.headers.authorization).toBe(`Bearer ${KEY}`)
	await shot(page, "page-reader", info)

	// edit: only title/summary/body are sent, against the inspected revision
	await page.getByRole("button", { name: "Edit this revision" }).click()
	await page.getByLabel("Body").fill("Use identity edge v3.")
	await page.getByRole("button", { name: "Save revision" }).click()
	await expect(page.getByText("Use identity edge v3.").first()).toBeVisible()
	const patch = api.log.find((r) => r.method === "PATCH")
	expect(patch?.body).toEqual({
		scope: "workspace",
		scopeRef: "ref-a",
		agentId: "agent-a",
		expectedRevision: 1,
		body: "Use identity edge v3.",
	})

	// history: summaries first, content only after the person opens a revision
	const history = page.getByRole("region", { name: "Revision history" })
	const summaries = history.getByRole("list", { name: "Revision summaries" })
	await expect(summaries).toContainText("Revision 2, update")
	await expect(summaries).toContainText("Revision 1, create")
	await expect(history).not.toContainText("Use the edge adapter.")
	expect(api.log.some((r) => r.path.startsWith("/v1/wiki/revisions/"))).toBe(
		false,
	)

	await history.getByRole("button", { name: /Revision 1, create/ }).click()
	await expect(history.getByText("Stored content of revision 1")).toBeVisible()
	await expect(
		history.getByText("Use the edge adapter.", { exact: true }),
	).toBeVisible()
	expect(api.log.some((r) => r.path === "/v1/wiki/revisions/1")).toBe(true)
	await shot(page, "revision-snapshot", info)
})

test("shows a duplicate slug conflict and keeps the draft", async ({
	page,
}) => {
	const api = await open(page)
	api.seed("ref-a", { slug: "taken", title: "Taken page" })
	await createPage(page, "taken", "second try")
	await expect(alerts(page)).toContainText("already exists")
	await expect(page.getByLabel("Body")).toHaveValue("second try")
})

test("a stale edit is refused, keeps the draft and never overwrites", async ({
	page,
}) => {
	const api = await open(page)
	api.seed("ref-a", { slug: "policy", title: "Policy", body: "original" })
	await page.getByRole("button", { name: "Reload list" }).click()
	await page.getByRole("button", { name: /Policy/ }).click()
	await page.getByRole("button", { name: "Edit this revision" }).click()
	await page.getByLabel("Body").fill("my careful rewrite")

	api.bump("ref-a", "policy", "someone else's change")
	await page.getByRole("button", { name: "Save revision" }).click()

	await expect(alerts(page)).toContainText("page changed after you opened it")
	await expect(page.getByLabel("Body")).toHaveValue("my careful rewrite")
	expect(api.pages.get("ref-a::policy")?.body).toBe("someone else's change")

	await page.getByRole("button", { name: "Show the latest revision" }).click()
	await expect(page.getByText("Latest stored text, revision 2")).toBeVisible()
	expect(api.pages.get("ref-a::policy")?.revision).toBe(2)

	await page
		.getByRole("button", { name: /Keep my edits and save against revision 2/ })
		.click()
	await expect(
		page.getByRole("heading", { name: "Edit revision 2" }),
	).toBeVisible()
	await page.getByRole("button", { name: "Save revision" }).click()
	await expect(page.getByText("my careful rewrite").first()).toBeVisible()
	expect(api.pages.get("ref-a::policy")?.revision).toBe(3)
	const patches = api.log.filter((r) => r.method === "PATCH")
	expect(patches.map((p) => p.body.expectedRevision)).toEqual([1, 2])
	for (const p of patches) {
		expect(p.body).not.toHaveProperty("trustTier")
		expect(p.body).not.toHaveProperty("permissions")
		expect(p.body).not.toHaveProperty("frontmatter")
	}
})

test("a response from the previous identity never reaches the new view", async ({
	page,
}) => {
	const api = installFakeApi(page)
	api.seed("ref-a", { slug: "only-in-a", title: "Visible only in A" })
	api.seed("ref-b", { slug: "only-in-b", title: "Visible only in B" })
	const hold = { scopeRef: "ref-a", waiters: [] as Array<() => void> }
	api.control.holdList = hold
	await page.goto("/workspace")
	await connect(page, { scopeRef: "ref-a" })
	await expect.poll(() => hold.waiters.length).toBeGreaterThan(0)

	await page.getByRole("button", { name: "Change connection" }).click()
	await page.getByLabel("Scope reference").fill("ref-b")
	await page.getByRole("button", { name: "Connect" }).click()
	await expect(
		page.getByRole("button", { name: /Visible only in B/ }),
	).toBeVisible()

	for (const release of hold.waiters) release() // the outstanding responses for ref-a arrive only now
	await page.waitForTimeout(300)
	await expect(page.getByText("Visible only in A")).toHaveCount(0)
	await expect(
		page.getByRole("button", { name: /Visible only in B/ }),
	).toBeVisible()
})

test("the API key stays out of browser storage and is cleared on reload", async ({
	page,
}) => {
	await open(page)
	await expect(page.getByRole("button", { name: "New page" })).toBeVisible()
	const stored = await page.evaluate(async () => {
		const databases = await indexedDB.databases()
		return JSON.stringify({
			local: { ...localStorage },
			session: { ...sessionStorage },
			cookie: document.cookie,
			databases: databases.map((d) => d.name),
		})
	})
	expect(stored).not.toContain(KEY)
	await page.reload()
	await expect(page.getByLabel("API key")).toHaveValue("")
	await expect(page.getByLabel("Agent ID")).toHaveValue("")
})

test("separates zero results from failures and shows throttling and partial context", async ({
	page,
}, info) => {
	const api = await open(page)
	await page.getByRole("button", { name: "Conversation memory" }).click()
	await memory(page).getByLabel("Query").fill("deploy")

	api.control.detailed = "zero"
	await page.getByRole("button", { name: "Retrieve evidence" }).click()
	await expect(
		page.getByText("No evidence returned for “deploy”"),
	).toBeVisible()
	await expect(
		page.getByText(/Reason reported by the API: no events matched/),
	).toBeVisible()
	await expect(alerts(page)).toHaveCount(0)

	api.control.detailed = "error"
	await page.getByRole("button", { name: "Retrieve evidence" }).click()
	await expect(alerts(page)).toContainText("Retrieval failed")
	await expect(page.getByText("No evidence returned")).toHaveCount(0)

	api.control.detailed = "throttled"
	await page.getByRole("button", { name: "Retrieve evidence" }).click()
	await expect(page.getByText("Retrieval was throttled")).toBeVisible()
	await expect(
		page.getByText("User prefers Friday deploys.", { exact: true }),
	).toBeVisible()
	await shot(page, "evidence-compact", info)
	// two short results stay compact enough to compare side by side
	const first = await page
		.getByLabel("Evidence 1 fields")
		.locator("xpath=ancestor::article[1]")
		.boundingBox()
	expect(first?.height ?? 999).toBeLessThan(320)
	const evidence = marginBox(page, "Evidence 1 fields")
	await expect(evidence).toContainText("canon-1")
	await expect(evidence).toContainText("medium")
	await expect(evidence.getByText("scope-exact, single-source")).toBeHidden() // collapsed
	await openAllFields(page, "Evidence 1 fields")
	await expect(evidence.getByText("scope-exact, single-source")).toBeVisible()
	await expect(evidence).toContainText("event-9")
	const sparse = marginBox(page, "Evidence 2 fields")
	await expect(sparse).toContainText("not reported")
	// the disclosure opens from the keyboard and still lists every unreported field
	await sparse.locator("summary").focus()
	await page.keyboard.press("Enter")
	await expect(sparse.locator("details")).toHaveAttribute("open", "")
	await expect(
		sparse.locator("dt", { hasText: "not reported" }).last(),
	).toBeVisible()
	await expect(sparse).toContainText("valid to")

	await shot(page, "evidence", info)

	await page.getByRole("button", { name: "Build context bundle" }).click()
	await expect(page.getByText("partial result")).toBeVisible()
	await expect(page.getByText(/^## Active context/)).toBeVisible()
	await expect(page.getByLabel("Context bundle fields")).toContainText("800")
	// retrieval output carries no authored ranking explanation
	await expect(page.getByText(/ranked (first|higher)/i)).toHaveCount(0)
})

test("evidence search sends an explicit session filter and never relabels shown results", async ({
	page,
}) => {
	const api = await open(page)
	await page.getByRole("button", { name: "Conversation memory" }).click()
	const panel = memory(page)

	// the field states what it filters and that the bundle is not constrained
	await expect(
		panel.getByText(/Filters evidence search to one session/),
	).toBeVisible()
	await expect(
		panel.getByText(/context bundle is built over the connected scope/),
	).toBeVisible()

	await panel.getByLabel("Query").fill("deploy")
	await panel.getByLabel("Search session ID").fill("session-277")
	await panel.getByRole("button", { name: "Retrieve evidence" }).click()
	await expect(
		page.getByText("User prefers Friday deploys.", { exact: true }),
	).toBeVisible()
	const scoped = api.log.filter((r) => r.path === "/v1/search-detailed")
	expect(scoped).toHaveLength(1)
	expect(scoped[0]?.body.conversationScope).toEqual({
		sessionKey: "session-277",
	})
	// the request summary records the session that produced these results
	await expect(
		page.getByText(
			"Evidence search for “deploy” filtered to session session-277.",
		),
	).toBeVisible()

	// the bundle stays over the connected scope even with the filter set
	await panel.getByRole("button", { name: "Build context bundle" }).click()
	await expect(page.getByText(/^## Active context/)).toBeVisible()
	const bundles = api.log.filter((r) => r.path === "/v1/context-bundle")
	expect(bundles).toHaveLength(1)
	expect(bundles[0]?.body.conversationScope).toBeUndefined()

	// clearing the filter sends an unscoped request
	await panel.getByLabel("Search session ID").fill("")
	await panel.getByRole("button", { name: "Retrieve evidence" }).click()
	await expect(
		page.getByText("User prefers Friday deploys.", { exact: true }),
	).toBeVisible()
	const searches = api.log.filter((r) => r.path === "/v1/search-detailed")
	expect(searches).toHaveLength(2)
	expect(searches[1]?.body.conversationScope).toBeUndefined()
	await expect(
		page.getByText("Evidence search for “deploy” across the connected scope."),
	).toBeVisible()

	// editing the field after results cannot relabel the results already shown
	await panel.getByLabel("Search session ID").fill("session-999")
	await expect(
		page.getByText("Evidence search for “deploy” across the connected scope."),
	).toBeVisible()
	await expect(page.getByText(/session-999/)).toHaveCount(0)
	expect(api.log.filter((r) => r.path === "/v1/search-detailed")).toHaveLength(
		2,
	)
})

test("wiki search distinguishes an outage from no match", async ({ page }) => {
	const api = await open(page)
	await knowledge(page).getByLabel("Query").fill("zzz")
	api.control.wikiSearch = "ok"
	await page.getByRole("button", { name: "Search pages" }).click()
	await expect(page.getByText("No pages matched “zzz”")).toBeVisible()

	api.control.wikiSearch = "down"
	await page.getByRole("button", { name: "Search pages" }).click()
	await expect(alerts(page)).toContainText("Search unavailable")
	await expect(page.getByText("No pages matched")).toHaveCount(0)
})

test("event capture is labelled honestly and retries reuse the idempotency key", async ({
	page,
}, info) => {
	const api = await open(page)
	await page.getByRole("button", { name: "Conversation memory" }).click()
	await expect(
		page.getByText("saving a page does not add anything here"),
	).toBeVisible()

	await page.getByRole("button", { name: "Recall events" }).click()
	await expect(page.getByText("Recall returned no events")).toBeVisible()
	await expect(page.getByText(/MCP\s+tools/)).toBeVisible()

	await page.getByLabel("Session ID").first().fill("s-1")
	await page.getByLabel("Event text").fill("We deploy on Fridays.")
	api.control.addFailures = 1
	await page.getByRole("button", { name: "Store event" }).click()
	await expect(alerts(page)).toContainText("Event not confirmed")
	await page.getByRole("button", { name: "Store event" }).click()
	await expect(
		page.getByRole("heading", { name: "Event stored" }),
	).toBeVisible()

	const adds = api.log.filter((r) => r.path === "/v1/add")
	expect(adds).toHaveLength(2)
	expect(adds[0]?.headers["idempotency-key"]).toBeTruthy()
	expect(adds[1]?.headers["idempotency-key"]).toBe(
		adds[0]?.headers["idempotency-key"],
	)
	const receipt = page.getByLabel("Event receipt fields")
	await expect(receipt).toContainText("chunk created")
	await expect(receipt).toContainText("yes")
	// the only mention of extraction is the disclaimer that it is not shown
	await expect(
		page.getByText(/(was|were|been) extracted|extracted (facts|memor)/i),
	).toHaveCount(0)
	await expect(page.getByText(/not shown here/)).toBeVisible()

	await page.getByLabel("Event text").fill("A different event.")
	await page.getByRole("button", { name: "Store event" }).click()
	await expect(page.locator("h4", { hasText: "Event stored" })).toHaveCount(2)
	const third = api.log.filter((r) => r.path === "/v1/add")[2]
	expect(third?.headers["idempotency-key"]).not.toBe(
		adds[0]?.headers["idempotency-key"],
	)

	await page.getByRole("button", { name: "Recall session s-1" }).first().click()
	await expect(page.getByLabel("Cited event fields").first()).toContainText(
		"s-1",
	)
	await expect(page.getByText("We deploy on Fridays.").first()).toBeVisible()
	await shot(page, "memory-lane", info)
})

test("is usable by keyboard and has no serious accessibility violations", async ({
	page,
}, info) => {
	installFakeApi(page)
	await page.goto("/workspace")
	await shot(page, "connect", info)
	expect(await seriousViolations(page)).toEqual([])

	await page.getByLabel("API base URL").focus()
	await page.keyboard.press("Tab")
	await page.keyboard.type(KEY)
	await page.keyboard.press("Tab")
	await page.keyboard.type("agent-a")
	await page.keyboard.press("Tab")
	await page.keyboard.press("w") // select scope by typing
	await page.keyboard.press("Tab")
	await page.keyboard.type("ref-a")
	await page.keyboard.press("Enter")
	await expect(page.getByRole("button", { name: "New page" })).toBeVisible()

	await page.getByRole("button", { name: "New page" }).focus()
	await page.keyboard.press("Enter")
	await expect(
		page.getByRole("heading", { name: "New knowledge page" }),
	).toBeVisible()
	expect(await seriousViolations(page)).toEqual([])

	await page.getByRole("button", { name: "Conversation memory" }).focus()
	await page.keyboard.press("Space")
	await expect(
		page.getByRole("heading", { name: "Capture an event" }),
	).toBeVisible()
	expect(await seriousViolations(page)).toEqual([])

	const outline = await page.evaluate(() => {
		const active = document.activeElement as HTMLElement
		return getComputedStyle(active).outlineStyle
	})
	expect(outline).not.toBe("none")
})

// Delayed-write regressions: a mutation that finishes after the person has
// moved on must not change what they are looking at now.

test("a slow event write does not erase or lock the person's current text", async ({
	page,
}) => {
	const api = await open(page)
	await page.getByRole("button", { name: "Conversation memory" }).click()
	const text = page.getByLabel("Event text")
	await page.getByLabel("Session ID").first().fill("s-1")
	await text.fill("first event")
	const hold = api.holdNext("add")
	await page.getByRole("button", { name: "Store event" }).click()
	await expect.poll(hold.pending).toBeGreaterThan(0)

	// the submitted fields cannot be edited while the write is in flight
	await expect(text).toBeDisabled()
	hold.release()
	await expect(
		page.getByRole("heading", { name: "Event stored" }),
	).toBeVisible()
	await expect(text).toBeEnabled()
	await expect(text).toHaveValue("")

	// and text typed after the receipt is never cleared by an older completion
	await text.fill("second event, still unsent")
	await expect(text).toHaveValue("second event, still unsent")
})

test("a slow create cannot replace a newer form or page", async ({ page }) => {
	const api = await open(page)
	api.seed("ref-a", { slug: "existing", title: "Existing page" })
	await page.getByRole("button", { name: "Reload list" }).click()
	await page.getByRole("button", { name: "New page" }).click()
	await page.getByLabel("Title").fill("slow-one")
	await page.getByLabel("Slug").fill("slow-one")
	await page.getByLabel("Kind").selectOption("concept")
	await page.getByLabel("Frontmatter type").fill("note")
	await page.getByLabel("Summary").fill("s")
	await page.getByLabel("Body").fill("b")
	const hold = api.holdNext("create")
	await page.getByRole("button", { name: "Create page" }).click()
	await expect.poll(hold.pending).toBeGreaterThan(0)

	// move on: open another page, then start a fresh form and type into it
	await page.getByRole("button", { name: /Existing page/ }).click()
	await expect(
		page.getByRole("heading", { name: "Existing page", level: 3 }),
	).toBeVisible()
	await page.getByRole("button", { name: "New page" }).click()
	await page.getByLabel("Title").fill("my newer draft")

	hold.release()
	await page.waitForTimeout(400)
	await expect(page.getByLabel("Title")).toHaveValue("my newer draft")
	await expect(
		page.getByRole("heading", { name: "slow-one", level: 3 }),
	).toHaveCount(0)
})

test("a slow save cannot close an editor opened after Discard", async ({
	page,
}) => {
	const api = await open(page)
	api.seed("ref-a", { slug: "policy", title: "Policy", body: "original" })
	await page.getByRole("button", { name: "Reload list" }).click()
	await page.getByRole("button", { name: /Policy/ }).click()
	await page.getByRole("button", { name: "Edit this revision" }).click()
	await page.getByLabel("Body").fill("first draft")
	const hold = api.holdNext("patch")
	await page.getByRole("button", { name: "Save revision" }).click()
	await expect.poll(hold.pending).toBeGreaterThan(0)

	await page.getByRole("button", { name: "Discard draft" }).click()
	await page.getByRole("button", { name: "Edit this revision" }).click()
	await page.getByLabel("Body").fill("second draft")

	hold.release()
	await page.waitForTimeout(400)
	await expect(page.getByLabel("Body")).toHaveValue("second draft")
	await expect(
		page.getByRole("button", { name: "Save revision" }),
	).toBeVisible()
})
