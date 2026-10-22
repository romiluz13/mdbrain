import { defineConfig, devices } from "@playwright/test"

// A live /demo run walks every chapter and reads each source, so it needs more
// than the fixture's 30 s. The limit was set when a cite was a Memongo recall of
// 5 to 7 s and has not been measured again since cite resolves by id.
const LIVE = process.env.DEMO_E2E_LIVE === "1"
// A server already running, such as a production build, is used as it is.
const BASE_URL = process.env.DEMO_BASE_URL

export default defineConfig({
	testDir: "./e2e",
	timeout: LIVE ? 180_000 : 30_000,
	testMatch: "**/*.e2e.ts",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	reporter: "line",
	use: {
		baseURL: BASE_URL ?? "http://127.0.0.1:3040",
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
	webServer: BASE_URL
		? undefined
		: {
				command: "bun run dev",
				url: "http://127.0.0.1:3040",
				reuseExistingServer: !process.env.CI,
				timeout: 120_000,
			},
})
