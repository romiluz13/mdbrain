"use client"

import { useThree } from "@react-three/fiber"
import { type RefObject, useCallback, useEffect, useMemo } from "react"
import * as THREE from "three"
import type { Graph } from "../../../lib/demo-data/views.js"

const MOUSE_REACH = 16
// A finger is wider than a cursor: half of the 44 px touch target.
const TOUCH_REACH = 22
// A press that travels farther than this was a turn of the scene, not a tap.
const TAP_SLOP = 6

type Options = {
	graph: Graph
	spots: Float32Array
	group: RefObject<THREE.Group | null>
	onHover: (index: number) => void
	onPin: (slug: string) => void
}

/** Where a page's dot is on screen, in client pixels; null while it is behind
 * the camera. Shared by the pointer, so a tap and a test land on the same dot. */
export type ScreenLookup = (slug: string) => { x: number; y: number } | null

/** Hover, tap and click for the 3D map: the dot nearest the pointer within the
 * same reach the flat map uses wins. Picking is by projected distance, not by
 * ray, so a small dot is as easy to hit as it is in 2D. */
export function usePicking({
	graph,
	spots,
	group,
	onHover,
	onPin,
}: Options): ScreenLookup {
	const camera = useThree((state) => state.camera)
	const element = useThree((state) => state.gl.domElement)
	const scratch = useMemo(() => new THREE.Vector3(), [])
	/** Brings the matrices up to date and measures the stage, once per question. */
	const stage = useCallback(() => {
		group.current?.updateWorldMatrix(true, false)
		camera.updateMatrixWorld()
		return element.getBoundingClientRect()
	}, [camera, element, group])
	const project = useCallback(
		(index: number, rect: DOMRect) => {
			const holder = group.current
			if (!holder) {
				return null
			}
			scratch
				.set(spots[index * 3], spots[index * 3 + 1], spots[index * 3 + 2])
				.applyMatrix4(holder.matrixWorld)
				.project(camera)
			return scratch.z > 1
				? null
				: {
						x: rect.left + (scratch.x * 0.5 + 0.5) * rect.width,
						y: rect.top + (-scratch.y * 0.5 + 0.5) * rect.height,
						depth: scratch.z,
					}
		},
		[camera, group, scratch, spots],
	)
	const lookup = useCallback<ScreenLookup>(
		(slug) => {
			const index = graph.index.get(slug)
			return index === undefined ? null : project(index, stage())
		},
		[graph, project, stage],
	)

	useEffect(() => {
		const nearest = (clientX: number, clientY: number, reach: number) => {
			let best = -1
			let bestDistance = reach * reach
			let bestDepth = Number.POSITIVE_INFINITY
			const rect = stage()
			for (let i = 0; i < graph.nodes.length; i++) {
				const spot = project(i, rect)
				if (!spot) {
					continue
				}
				const distance = (spot.x - clientX) ** 2 + (spot.y - clientY) ** 2
				if (
					distance < bestDistance ||
					(distance === bestDistance && spot.depth < bestDepth)
				) {
					best = i
					bestDistance = distance
					bestDepth = spot.depth
				}
			}
			return best
		}
		let press: { x: number; y: number } | null = null
		let hovered = -1
		const setHover = (next: number) => {
			if (next !== hovered) {
				hovered = next
				element.style.cursor = next >= 0 ? "pointer" : ""
				onHover(next)
			}
		}
		const move = (event: PointerEvent) => {
			if (event.pointerType === "mouse" && event.buttons === 0) {
				setHover(nearest(event.clientX, event.clientY, MOUSE_REACH))
			}
		}
		const leave = () => setHover(-1)
		const down = (event: PointerEvent) => {
			press = { x: event.clientX, y: event.clientY }
		}
		const up = (event: PointerEvent) => {
			const start = press
			press = null
			if (
				!start ||
				Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) >
					TAP_SLOP
			) {
				return
			}
			const reach = event.pointerType === "touch" ? TOUCH_REACH : MOUSE_REACH
			const node = graph.nodes[nearest(event.clientX, event.clientY, reach)]
			if (node) {
				onPin(node.slug)
			}
		}
		element.addEventListener("pointermove", move)
		element.addEventListener("pointerleave", leave)
		element.addEventListener("pointerdown", down)
		element.addEventListener("pointerup", up)
		return () => {
			element.removeEventListener("pointermove", move)
			element.removeEventListener("pointerleave", leave)
			element.removeEventListener("pointerdown", down)
			element.removeEventListener("pointerup", up)
			element.style.cursor = ""
		}
	}, [graph, element, onHover, onPin, project, stage])

	return lookup
}
