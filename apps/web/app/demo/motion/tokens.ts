// The numbers every GSAP move on /demo is made of. Seconds, because GSAP's are.

/** One move is 300 to 600 ms; a sequence of them stays under 2.5 s. */
export const DURATION = {
	settle: 0.45,
	count: 0.6,
	arrive: 0.35,
	arrow: 0.4,
	slip: 0.45,
	stamp: 0.4,
	/** The camera's flight to the pair, and back. */
	fly: 0.6,
	/** The link between the pair lighting, and dimming. */
	light: 0.45,
	dim: 0.3,
} as const

export const EASE = {
	out: "power3.out",
	inOut: "power3.inOut",
	in: "power2.in",
	stamp: "back.out(1.6)",
} as const

export const STAGGER = {
	/** Between the lines of a chapter's head. */
	head: 0.06,
	/** Between rows of a stream. */
	rows: 0.045,
	/** Between the slips of one claim. */
	slips: 0.08,
} as const

/** The gap between rows, narrowed for a long run so the stream stays about as
 * long as a short one. */
export function rowStagger(count: number): number {
	return Math.min(STAGGER.rows, 0.6 / Math.max(1, count - 1))
}
