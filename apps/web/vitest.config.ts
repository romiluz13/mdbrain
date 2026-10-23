import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
	plugins: [react({})],
	resolve: {
		// The tsconfig `@/*` path, for route handlers under test.
		alias: { "@": __dirname },
	},
})
