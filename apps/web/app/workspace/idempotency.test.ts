import { describe, expect, it } from "vitest"
import { keyForWrite, writeFingerprint } from "./idempotency.js"

describe("keyForWrite", () => {
	it("keeps the key for an identical pending write and replaces it for a change", () => {
		let counter = 0
		const generate = () => `key-${++counter}`
		const first = keyForWrite(null, writeFingerprint(["a", "s1"]), generate)
		const retry = keyForWrite(first, writeFingerprint(["a", "s1"]), generate)
		const edited = keyForWrite(retry, writeFingerprint(["b", "s1"]), generate)
		expect(retry).toBe(first)
		expect(first.key).toBe("key-1")
		expect(edited.key).toBe("key-2")
	})
})
