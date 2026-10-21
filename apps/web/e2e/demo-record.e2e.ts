// Records the proxy's answers to the reads /demo makes, for the e2e to replay.
// Run it against a live slot with the proxy env set, so the run never prints a
// key:
//
//   DEMO_E2E_LIVE=1 DEMO_RECORD_TO=/some/recording.json \
//     bunx playwright test e2e/demo-record.e2e.ts --project=desktop-chromium
//
// It walks the journey, then opens the citation the value checks open, so a
// replay of the file can run the journey and the value specs. The file holds
// the upstream path, query and answer of each read, with the run's identity
// scrubbed; it is not written at all if an answer holds the key or an origin.
// Replay: DEMO_REPLAY=/some/recording.json bunx playwright test e2e/demo*.e2e.ts
import { expect, test } from "@playwright/test"
import { listPages, mapReady, openDemo, sourcesSettled } from "./demo-helpers"
import { journey, withKeyboard } from "./demo-journey"
import { installDemoProxy, LIVE } from "./demo-proxy"
import {
	forbiddenFromEnv,
	identityFromEnv,
	toRecording,
	writeRecording,
} from "./demo-recorded"

const OUT = process.env.DEMO_RECORD_TO

test.skip(!OUT, "set DEMO_RECORD_TO to record")
test.skip(
	!LIVE,
	"records a live stack; the generated fixture is not a recording",
)

test("records the reads the journey and the value checks make", async ({
	page,
	isMobile,
}) => {
	test.skip(isMobile, "one recording, from the desktop project")
	if (!OUT) return
	const proxy = await installDemoProxy(page)
	await journey(page, proxy, withKeyboard(page), "escape")

	await openDemo(page)
	await mapReady(page)
	await proxy.flush()
	const stored = listPages(proxy).find((candidate) =>
		candidate.claims[0]?.evidence.some((evidence) => evidence.kind === "event"),
	)
	expect(stored, "a stored page with a cited source").toBeDefined()
	if (!stored) return
	await page.getByLabel("Pick a page").selectOption({ label: stored.title })
	await page
		.getByRole("complementary", { name: "Page inspector" })
		.getByRole("button", { name: /^Open citation for:/ })
		.first()
		.click()
	await sourcesSettled(page.getByRole("dialog"))
	await page.keyboard.press("Escape")

	await proxy.flush()
	const forbidden = forbiddenFromEnv()
	expect(
		forbidden.length,
		"the proxy env is set, so the key and the origin are known and refused",
	).toBeGreaterThan(0)
	const recording = toRecording(proxy.responses, forbidden, identityFromEnv())
	writeRecording(OUT, recording)
	console.log(`[demo-record] ${recording.reads.length} reads recorded`)
})
