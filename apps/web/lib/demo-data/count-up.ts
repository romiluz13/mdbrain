// The path a headline number takes on its way to the API's value. The final
// number is always the value it was given: the path is only how it gets there.

const easeOut = (progress: number): number => 1 - (1 - progress) ** 3

/** The whole number shown at `progress` (0 to 1) on the way to `value`. A value
 * that is not a non-negative whole number is not a count, so it is returned as
 * it is rather than rewritten. */
export function countAt(value: number, progress: number): number {
	if (!Number.isInteger(value) || value < 0) {
		return value
	}
	if (!(progress > 0)) {
		return 0
	}
	if (progress >= 1) {
		return value
	}
	return Math.min(value, Math.round(value * easeOut(progress)))
}

/** What a count that ends early leaves in its text node. Its own last step is
 * replaced by the final text; a text React wrote since (the value changed, or
 * went back to loading) is not ours to overwrite. */
export function textAfterCountUp(
	current: string | null,
	lastStep: string,
	finalText: string,
): string {
	return current === null || current === lastStep ? finalText : current
}
