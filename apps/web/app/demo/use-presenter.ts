"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
	createPresenterClient,
	type ActionResult,
	type LeaseView,
	type PresenterSnapshot,
	type RequestView,
	type StateRead,
} from "../../lib/demo-presenter/client.js"

export type ProposalRow = {
	operationId: string
	title: string
	slug: string
	summary: string
	claimCount: number
	proposedAt: string
	proposedBy: string
}

export type PresenterMessage = { tone: "error" | "info"; text: string }

export type Presenter = {
	/** "loading" until the first state read settles; a visitor is "public". */
	mode: "loading" | "public" | "presenter"
	lease: LeaseView | null
	request: RequestView | null
	/** The action in flight, so its button can say so. */
	busy: string | null
	message: PresenterMessage | null
	actions: {
		lease: (name?: string) => Promise<void>
		release: () => Promise<void>
		rename: (name: string) => Promise<void>
		run: () => Promise<void>
		pin: () => Promise<void>
		signOut: () => Promise<void>
		proposals: () => Promise<ProposalRow[] | null>
		decide: (
			operationId: string,
			decision: "approve" | "reject",
			reason?: string,
		) => Promise<{ state: "promoted" | "rejected"; pageSlug?: string } | null>
		dismiss: () => void
	}
}

const KEEPALIVE_MS = 10_000
/** While a run is queued or claimed the request's state is what moves. */
const WATCH_MS = 2_500

const LOST = "The server did not answer. The page keeps trying."

/** What one state read does to the page. A failed read says nothing about who
 * is looking: a presenter stays a presenter, and a visitor stays public. */
export type ReadEffect =
	| { kind: "lost" }
	| { kind: "public" }
	| {
			kind: "settled"
			snapshot: PresenterSnapshot
			presenting: boolean
			csrf: string
	  }

export function readEffect(next: StateRead, presenting: boolean): ReadEffect {
	if (next.mode === "unavailable")
		return { kind: presenting ? "lost" : "public" }
	return {
		kind: "settled",
		snapshot: next,
		presenting: next.mode === "presenter",
		csrf: next.mode === "presenter" ? next.csrf : "",
	}
}

/** How often the page asks the server again. */
export function pollMs(requestState: RequestView["state"] | undefined): number {
	return requestState === "queued" || requestState === "claimed"
		? WATCH_MS
		: KEEPALIVE_MS
}

/** The presenter's state and actions. A visitor's page never gets a presenter
 * control: anything but a confirmed presenter state reads as public. */
export function usePresenter(): Presenter {
	const client = useMemo(() => createPresenterClient(), [])
	const [snapshot, setSnapshot] = useState<PresenterSnapshot | null>(null)
	const [busy, setBusy] = useState<string | null>(null)
	const [message, setMessage] = useState<PresenterMessage | null>(null)
	const csrf = useRef("")
	const presentingNow = useRef(false)

	const refresh = useCallback(async () => {
		const effect = readEffect(await client.state(), presentingNow.current)
		if (effect.kind === "settled") {
			presentingNow.current = effect.presenting
			csrf.current = effect.csrf
			setSnapshot(effect.snapshot)
			setMessage((current) => (current?.text === LOST ? null : current))
			return
		}
		// One failed read must not end a presenter's session on screen; the
		// poll keeps going and the next good read puts the page right.
		if (effect.kind === "lost") setMessage({ tone: "info", text: LOST })
		else setSnapshot({ mode: "public" })
	}, [client])

	useEffect(() => {
		void refresh()
	}, [refresh])

	const presenting = snapshot?.mode === "presenter"
	const requestState =
		snapshot?.mode === "presenter" ? snapshot.request?.state : undefined
	const interval = pollMs(requestState)
	useEffect(() => {
		if (!presenting) return
		const timer = setInterval(() => void refresh(), interval)
		return () => clearInterval(timer)
	}, [presenting, interval, refresh])

	const act = useCallback(
		async (
			name: string,
			path: string,
			body: unknown,
			quiet = false,
		): Promise<ActionResult> => {
			setBusy(name)
			setMessage(null)
			const result = await client.post(path, body, csrf.current)
			setBusy(null)
			if (!result.ok && !quiet) {
				setMessage({ tone: "error", text: result.message })
			}
			if (result.ok || result.status === 401) await refresh()
			return result
		},
		[client, refresh],
	)

	const actions = useMemo<Presenter["actions"]>(
		() => ({
			lease: async (name) => {
				await act("lease", "lease", name ? { name } : {})
			},
			release: async () => {
				await act("release", "lease/release", {})
			},
			rename: async (name) => {
				await act("rename", "lease/name", { name })
			},
			run: async () => {
				await act("run", "run", {})
			},
			pin: async () => {
				const result = await act("pin", "pin", {})
				if (result.ok) {
					setMessage({
						tone: "info",
						text: "Pinned. Public mode plays this run back from now on.",
					})
				}
			},
			signOut: async () => {
				await act("signout", "session/end", {}, true)
				window.location.assign("/demo")
			},
			proposals: async () => {
				const result = await client.get("proposals")
				if (!result.ok) {
					setMessage({ tone: "error", text: result.message })
					return null
				}
				return (result.body.proposals as ProposalRow[]) ?? []
			},
			decide: async (operationId, decision, reason) => {
				const result = await act("decide", "proposals/decide", {
					operationId,
					decision,
					...(reason ? { reason } : {}),
				})
				return result.ok
					? (result.body as {
							state: "promoted" | "rejected"
							pageSlug?: string
						})
					: null
			},
			dismiss: () => setMessage(null),
		}),
		[act, client],
	)

	return useMemo<Presenter>(
		() => ({
			mode: snapshot === null ? "loading" : snapshot.mode,
			lease: snapshot?.mode === "presenter" ? snapshot.lease : null,
			request: snapshot?.mode === "presenter" ? snapshot.request : null,
			busy,
			message,
			actions,
		}),
		[snapshot, busy, message, actions],
	)
}
