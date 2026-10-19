export type PendingWrite = { fingerprint: string; key: string }

export function newKey(): string {
	if (typeof crypto.randomUUID === "function") {
		return crypto.randomUUID()
	}
	return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("")
}

export function writeFingerprint(parts: readonly string[]): string {
	return JSON.stringify(parts)
}

/** Reuse the key while the identical write is still unconfirmed, so a retry
 *  after a timeout or 5xx is the same delivery. Any change gets a new key. */
export function keyForWrite(
	pending: PendingWrite | null,
	fingerprint: string,
	generate: () => string = newKey,
): PendingWrite {
	return pending && pending.fingerprint === fingerprint
		? pending
		: { fingerprint, key: generate() }
}
