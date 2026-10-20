// Runs the radial layout off the main thread. The page posts the nodes once
// and gets two transferable coordinate arrays back.
import { layoutRadial, type LayoutNode } from "./graph-layout.js"

export type LayoutRequest = {
	nodes: LayoutNode[]
	hub: number
	groupOrder: string[]
}

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
	const { nodes, hub, groupOrder } = event.data
	const { x, y } = layoutRadial(nodes, hub, groupOrder)
	;(self as unknown as Worker).postMessage({ x, y }, [x.buffer, y.buffer])
}
