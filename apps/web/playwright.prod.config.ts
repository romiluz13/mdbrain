import { defineConfig, devices } from "@playwright/test"

// The production lane for the /demo specs: `bun run test:e2e:prod` builds the
// app (and its workspace deps) with turbo, serves the build with `next start`
// — "starts the application in production mode. The application should be
// compiled with `next build` first" (Next 16 CLI reference,
// node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md) — and
// runs the specs against the in-page fixture. The dev lane
// (playwright.config.ts / `bun run test:e2e`) is unchanged.
//
// demo-bounds is excluded: it needs DEMO_BOUNDS=1 and a GPU Chrome, neither of
// which a CI runner offers. demo-perf and demo-shots skip themselves without
// DEMO_PERF / DEMO_SHOTS_DIR, so they cost nothing here.
//
// The port defaults to 3041 so this lane never collides with the dev server on
// 3040; DEMO_E2E_PROD_PORT overrides it for both `next start` and baseURL.
const PORT = process.env.DEMO_E2E_PROD_PORT ?? "3041"
const ci = Boolean(process.env.CI)

export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.e2e.ts",
	testIgnore: /demo-bounds/,
	timeout: 30_000,
	fullyParallel: true,
	forbidOnly: ci,
	retries: ci ? 2 : 0,
	// One worker in CI for stability, and a global timeout comfortably below
	// the job's own timeout, per the Playwright CI guide (playwright.dev/docs/ci).
	workers: ci ? 1 : undefined,
	globalTimeout: ci ? 20 * 60_000 : undefined,
	reporter: ci ? [["line"], ["html", { open: "never" }]] : "line",
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "desktop-chromium",
			use: { ...devices["Desktop Chrome"] },
		},
		{
			name: "mobile-chromium",
			use: { ...devices["Pixel 7"] },
		},
	],
	// webServer options per the Playwright test-webserver guide: `command`
	// starts the server, `url` is polled for readiness, `reuseExistingServer`
	// reuses a local server so the lane can run against an already-started
	// build, and `timeout` bounds the readiness wait.
	webServer: {
		command: `next start -p ${PORT}`,
		url: `http://127.0.0.1:${PORT}`,
		reuseExistingServer: !ci,
		timeout: 60_000,
	},
})
