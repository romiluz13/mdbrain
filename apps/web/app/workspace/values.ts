export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined
}

export function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined
}

export function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function asStringList(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every((item) => typeof item === "string")
		? (value as string[])
		: undefined
}

export function isEmptyValue(value: unknown): boolean {
	if (value === undefined || value === null || value === "") {
		return true
	}
	if (Array.isArray(value)) {
		return value.length === 0
	}
	const record = asRecord(value)
	return record !== undefined && Object.keys(record).length === 0
}

/** "2026-10-06T19:55:10.315Z" -> "2026-10-06 19:55:10Z". Shown in UTC so two
 *  viewers read the same record the same way. */
export function formatInstant(value: string | undefined): string | undefined {
	if (!value) {
		return undefined
	}
	const parsed = new Date(value)
	if (Number.isNaN(parsed.getTime())) {
		return value
	}
	return `${parsed.toISOString().slice(0, 19).replace("T", " ")}Z`
}

export function formatNumber(value: number | undefined): string | undefined {
	return value === undefined ? undefined : String(value)
}

export function formatBytes(text: string): string {
	const bytes = new TextEncoder().encode(text).length
	return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`
}

/** Join a list the API may not have sent. Undefined when absent or empty so
 *  the margin reads "not reported". */
export function joinList(values: unknown): string | undefined {
	return Array.isArray(values) && values.length > 0
		? values.map(String).join(", ")
		: undefined
}

export function flag(value: unknown): string | undefined {
	return typeof value === "boolean" ? String(value) : undefined
}
