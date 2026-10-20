/** Slot naming and idempotency-key derivation for run-slot seeding.
 *
 * One convention, used by the seeder, the pool, the live check, and (with the
 * same literals pinned by scripts/demo-stack-config.test.ts) by the demo
 * stack's scoped-key configuration: slot `i` (1-based) owns scopeRef
 * `demo-run-<i>` and agentId `demo-run-<i>`. */
export function slotScopeRef(index: number): string {
	return `demo-run-${assertSlotIndex(index)}`
}

export function slotAgentId(index: number): string {
	return `demo-run-${assertSlotIndex(index)}`
}

/** Stable idempotency key for one corpus event inside one slot. The same
 * slot + source always yields the same key, so a resumed run re-sends the
 * same key and the delivery ledger returns the original receipt. */
export function eventKey(scopeRef: string, sourceId: string): string {
	return `seed:${scopeRef}:event:${sourceId}`
}

/** Stable idempotency key for one wiki page inside one slot. */
export function pageKey(scopeRef: string, slug: string): string {
	return `seed:${scopeRef}:page:${slug}`
}

function assertSlotIndex(index: number): number {
	if (!Number.isInteger(index) || index < 1) {
		throw new RangeError(`slot index must be a positive integer, got ${index}`)
	}
	return index
}
