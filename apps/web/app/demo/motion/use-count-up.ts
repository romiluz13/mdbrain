"use client"

import type { RefObject } from "react"
import { countAt } from "../../../lib/demo-data/count-up.js"
import { gsap, useGSAP } from "./gsap-react.js"
import { DURATION } from "./tokens.js"
import { useReducedMotion } from "./use-reduced-motion.js"

/** Counts the number in `ref`'s first text node up from 0 to `value`. React owns
 * that node and its text is always the API's value once the move ends, is
 * interrupted, or motion is reduced. `follow` hears the number shown at each
 * step, for a bar that fills with it. */
export function useCountUp(
	ref: RefObject<HTMLElement | null>,
	value: number | string | null,
	format: (shown: number) => string = String,
	follow?: (shown: number) => void,
): void {
	const reduced = useReducedMotion()
	useGSAP(
		() => {
			const node = ref.current?.firstChild
			if (
				reduced ||
				typeof value !== "number" ||
				!Number.isInteger(value) ||
				value <= 0 ||
				node?.nodeType !== Node.TEXT_NODE
			) {
				return
			}
			const run = { progress: 0 }
			const show = (shown: number) => {
				node.nodeValue = format(shown)
				follow?.(shown)
			}
			const step = () => show(countAt(value, run.progress))
			step()
			gsap.to(run, {
				progress: 1,
				duration: DURATION.count,
				ease: "none",
				onUpdate: step,
				onComplete: step,
			})
			return () => show(value)
		},
		{ scope: ref, dependencies: [reduced, value], revertOnUpdate: true },
	)
}
