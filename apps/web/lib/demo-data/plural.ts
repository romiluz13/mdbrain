/** A count with its noun, in the singular only for exactly one: "1 claim",
 * "0 claims", "2 matches". */
export function countOf(
	count: number,
	noun: string,
	plural = `${noun}s`,
): string {
	return `${count} ${count === 1 ? noun : plural}`
}
