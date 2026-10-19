"use client"

import { MdbrainClient, type MdbrainRequestOptions } from "@mdbrain/client"
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from "react"
import type { Connection } from "./identity.js"
import { StaleConnectionError } from "./describe-error.js"

export type WorkspaceApi = {
	connection: Connection
	/** Run one SDK call tied to this connection. If the connection is replaced
	 *  first the request is aborted and the result is dropped as stale. */
	call: <T>(
		fn: (client: MdbrainClient, options: MdbrainRequestOptions) => Promise<T>,
	) => Promise<T>
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null)

export function ConnectionProvider({
	connection,
	children,
}: {
	connection: Connection
	children: ReactNode
}) {
	const lifetime = useRef<AbortController | null>(null)

	useEffect(
		() => () => {
			lifetime.current?.abort()
			lifetime.current = null
		},
		[],
	)

	const api = useMemo<WorkspaceApi>(() => {
		const client = new MdbrainClient({
			baseUrl: connection.baseUrl,
			apiKey: connection.apiKey || undefined,
			maxRetries: 0,
			defaultDeadlineMs: 45_000,
		})
		return {
			connection,
			call: async (fn) => {
				if (!lifetime.current || lifetime.current.signal.aborted) {
					lifetime.current = new AbortController()
				}
				const { signal } = lifetime.current
				const result = await fn(client, { signal })
				if (signal.aborted) {
					throw new StaleConnectionError()
				}
				return result
			},
		}
	}, [connection])

	return (
		<WorkspaceContext.Provider value={api}>
			{children}
		</WorkspaceContext.Provider>
	)
}

export function useWorkspace(): WorkspaceApi {
	const api = useContext(WorkspaceContext)
	if (!api) {
		throw new Error("useWorkspace must be used inside ConnectionProvider")
	}
	return api
}
