"use client"

import { useEffect, useState } from "react"
import { layoutRadial, type Layout } from "../../lib/demo-data/graph-layout.js"
import type { LayoutRequest } from "../../lib/demo-data/graph-layout.worker.js"
import type { Graph } from "../../lib/demo-data/views.js"

function request(graph: Graph): LayoutRequest {
	return {
		nodes: graph.nodes.map((node) => ({
			slug: node.slug,
			group: node.group,
			degree: node.degree,
		})),
		hub: graph.hub,
		groupOrder: graph.groups.map((group) => group.id),
	}
}

/** Lays the graph out in a Worker so the main thread never runs it. Without
 * Worker support, or if the Worker fails, the same pure function runs inline:
 * it is O(n log n), so that fallback stays cheap. */
export function useLayout(graph: Graph | null): Layout | null {
	const [layout, setLayout] = useState<Layout | null>(null)

	useEffect(() => {
		if (graph === null) {
			setLayout(null)
			return
		}
		const input = request(graph)
		const inline = () =>
			setLayout(layoutRadial(input.nodes, input.hub, input.groupOrder))
		if (typeof Worker === "undefined") {
			inline()
			return
		}
		let worker: Worker
		try {
			worker = new Worker(
				// webpack needs this exact `new URL(..., import.meta.url)` form to
				// bundle the worker; the web tsconfig builds as CommonJS and flags it.
				// @ts-expect-error TS1470
				new URL("../../lib/demo-data/graph-layout.worker.ts", import.meta.url),
			)
		} catch {
			inline()
			return
		}
		let live = true
		worker.onmessage = (event: MessageEvent<Layout>) => {
			if (live) {
				setLayout(event.data)
			}
		}
		worker.onerror = () => {
			if (live) {
				inline()
			}
		}
		worker.postMessage(input)
		return () => {
			live = false
			worker.terminate()
		}
	}, [graph])

	return layout
}
