import { describe, expect, it } from "vitest"
import { redactSensitiveText } from "./redact.js"

const MONGODB_USERNAME_PLACEHOLDER = "YOUR_USERNAME_HERE"
const MONGODB_PASSWORD_PLACEHOLDER = "YOUR_PASSWORD_HERE"
const mongodbUrl = new URL("mongodb://localhost:27017/db")
mongodbUrl.username = MONGODB_USERNAME_PLACEHOLDER
mongodbUrl.password = MONGODB_PASSWORD_PLACEHOLDER

describe("redactSensitiveText", () => {
	it.each([
		[
			"bearer",
			"Authorization: Bearer YOUR_BEARER_TOKEN_HERE",
			"YOUR_BEARER_TOKEN_HERE",
		],
		[
			"api key",
			"MEMONGO_API_KEY=YOUR_MEMONGO_API_KEY_HERE",
			"YOUR_MEMONGO_API_KEY_HERE",
		],
		["MongoDB password", mongodbUrl.toString(), MONGODB_PASSWORD_PLACEHOLDER],
	])("redacts %s values without returning the source text", (_name, input, secret) => {
		const redacted = redactSensitiveText(input)

		expect(redacted).not.toContain(secret)
		expect(redacted).toContain("***")
	})
})
