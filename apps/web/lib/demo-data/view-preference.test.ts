import { describe, expect, it } from "vitest"
import {
	VIEW_PREFERENCE_KEY,
	readViewPreference,
	writeViewPreference,
	type PreferenceStorage,
} from "./view-preference.js"

function memory(): PreferenceStorage & { data: Map<string, string> } {
	const data = new Map<string, string>()
	return {
		data,
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => void data.set(key, value),
	}
}

const refusing: PreferenceStorage = {
	getItem: () => {
		throw new Error("storage is blocked")
	},
	setItem: () => {
		throw new Error("storage is blocked")
	},
}

describe("the remembered graph view", () => {
	it("remembers a choice and reads it back", () => {
		const storage = memory()
		writeViewPreference("2d", storage)
		expect(storage.data.get(VIEW_PREFERENCE_KEY)).toBe("2d")
		expect(readViewPreference(storage)).toBe("2d")
		writeViewPreference("3d", storage)
		expect(readViewPreference(storage)).toBe("3d")
	})

	it("reads nothing when nothing was stored, or something that is not a choice", () => {
		const storage = memory()
		expect(readViewPreference(storage)).toBeNull()
		storage.data.set(VIEW_PREFERENCE_KEY, "sideways")
		expect(readViewPreference(storage)).toBeNull()
	})

	it("works without storage: a blocked read is no choice, a blocked write is ignored", () => {
		expect(readViewPreference(refusing)).toBeNull()
		expect(() => writeViewPreference("2d", refusing)).not.toThrow()
	})

	it("works when the storage accessor itself throws, as in a private window", () => {
		const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			get() {
				throw new Error("denied")
			},
		})
		try {
			expect(readViewPreference()).toBeNull()
			expect(() => writeViewPreference("3d")).not.toThrow()
		} finally {
			if (original) {
				Object.defineProperty(globalThis, "localStorage", original)
			} else {
				Reflect.deleteProperty(globalThis, "localStorage")
			}
		}
	})
})
