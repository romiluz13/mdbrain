"use client"

import { useSyncExternalStore } from "react"
import { motionReduced, subscribeMotion } from "./motion.js"

/** True while the viewer asks for reduced motion; read before the first data
 * read starts, so a viewer who asked for it never sees a moving frame. */
export function useReducedMotion(): boolean {
	return useSyncExternalStore(subscribeMotion, motionReduced, () => false)
}
