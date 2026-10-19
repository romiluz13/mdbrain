"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
	describeError,
	type DescribedError,
	isStale,
} from "./describe-error.js"

export type Latest<T> =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ok"; data: T }
	| { status: "error"; error: DescribedError }

/** One user-visible request slot. A newer `run` supersedes an older one, so a
 *  slow earlier response can never replace what the person asked for last. */
export function useLatest<T>() {
	const [state, setState] = useState<Latest<T>>({ status: "idle" })
	const token = useRef(0)

	// A slot dies with the view that owns it. Bumping the token on cleanup
	// makes any request still in flight return undefined instead of acting.
	useEffect(
		() => () => {
			token.current++
		},
		[],
	)

	const run = useCallback(
		async (task: () => Promise<T>): Promise<T | undefined> => {
			const mine = ++token.current
			setState({ status: "loading" })
			try {
				const data = await task()
				if (mine !== token.current) {
					return undefined
				}
				setState({ status: "ok", data })
				return data
			} catch (error) {
				if (mine !== token.current || isStale(error)) {
					return undefined
				}
				setState({ status: "error", error: describeError(error) })
				return undefined
			}
		},
		[],
	)

	const reset = useCallback(() => {
		token.current++
		setState({ status: "idle" })
	}, [])

	return { state, run, reset }
}
