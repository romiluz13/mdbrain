// The viewer's choice between the 3D and the flat graph, kept in this browser
// only. Storage can be absent or throw (a private window, blocked site data),
// and the page must read the same without it.

export const VIEW_PREFERENCE_KEY = "mdbrain.demo.graph-view"

export type PreferenceStorage = Pick<Storage, "getItem" | "setItem">

export type ViewPreference = "3d" | "2d"

function browserStorage(): PreferenceStorage | null {
	try {
		return globalThis.localStorage ?? null
	} catch {
		return null
	}
}

export function readViewPreference(
	storage: PreferenceStorage | null = browserStorage(),
): ViewPreference | null {
	try {
		const stored = storage?.getItem(VIEW_PREFERENCE_KEY)
		return stored === "3d" || stored === "2d" ? stored : null
	} catch {
		return null
	}
}

export function writeViewPreference(
	value: ViewPreference,
	storage: PreferenceStorage | null = browserStorage(),
): void {
	try {
		storage?.setItem(VIEW_PREFERENCE_KEY, value)
	} catch {
		// Not remembering is the only consequence.
	}
}
