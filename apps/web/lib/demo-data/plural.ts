/** A count with its noun, in the singular only for exactly one: "1 claim",
 * "0 claims", "2 pages". */
export function countOf(count: number, noun: string): string {
	return `${count} ${count === 1 ? noun : `${noun}s`}`
}

/** Evidence a claim stores that is not a source event, counted and agreed:
 * "1 evidence item that is not a source event". */
export function nonEventEvidence(count: number): string {
	return `${countOf(count, "evidence item")} that ${count === 1 ? "is not a source event" : "are not source events"}`
}
