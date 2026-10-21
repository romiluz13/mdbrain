import { defineConfig, devices } from "@playwright/test"

// A live /demo run reads each source through Memongo recall, 5 to 7 s apiece,
// and a test walks every chapter, so it needs more than the fixture's 30 s.
const LIVE = process.env.DEMO_E2E_LIVE === "1"

export default defineConfig({
	testDir: "./e2e",
	timeout: LIVE ? 180_000 : 30_000,
	testMatch: "**/*.e2e.ts",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	reporter: "line",
	use: {
		baseURL: "http://127.0.0.1:3040",
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
	webServer: {
		command: "bun run dev",
		url: "http://127.0.0.1:3040",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
})
