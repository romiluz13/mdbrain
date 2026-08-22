import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
	testDir: "./e2e",
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
