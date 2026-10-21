"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { Layout } from "../../../lib/demo-data/graph-layout.js"
import { NodeGrid } from "../../../lib/demo-data/node-grid.js"
import type { Graph } from "../../../lib/demo-data/views.js"
import styles from "../graph.module.css"

type Props = {
	graph: Graph
	layout: Layout
	highlight: ReadonlySet<string>
	pinned: string | null
	onPin: (slug: string) => void
	label: string
	/** Fills the box it sits in instead of sizing itself. */
	fill?: boolean
}

const SIGNAL = "#e5502b"
const SCOPE_INK = "#f6f8f5"
const LABEL_FONT = '600 12px "Archivo Variable", Archivo, system-ui, sans-serif'
const MOUSE_REACH = 16
// A finger is wider than a cursor: half of the 44 px touch target.
const TOUCH_REACH = 22
const MAX_LABELS = 6

type Size = { width: number; height: number }

/** How often each layer has been drawn, readable by tests: the static layer
 * must stay at one draw per data, layout or size change. */
function countDraw(canvas: HTMLCanvasElement): void {
	canvas.dataset.draws = String(Number(canvas.dataset.draws ?? 0) + 1)
}

function nodeRadius(degree: number, width: number): number {
	return (width < 520 ? 3.2 : 3.6) + Math.min(degree, 14) * 0.28
}

/** Two stacked canvases. The static layer (guides, edges, nodes) is drawn only
 * when the data, the layout or the size changes and then stays cached by the
 * browser as a bitmap; the live layer redraws just the rings and labels for
 * the highlighted, hovered and pinned pages. */
export function GraphCanvas({
	graph,
	layout,
	highlight,
	pinned,
	onPin,
	label,
	fill,
}: Props) {
	const wrapRef = useRef<HTMLDivElement>(null)
	const staticRef = useRef<HTMLCanvasElement>(null)
	const liveRef = useRef<HTMLCanvasElement>(null)
	const [size, setSize] = useState<Size>({ width: 0, height: 0 })
	const [hovered, setHovered] = useState<number>(-1)

	useEffect(() => {
		const wrap = wrapRef.current
		if (wrap === null) {
			return
		}
		const measure = () => {
			const box = wrap.getBoundingClientRect()
			setSize((current) =>
				current.width === Math.round(box.width) &&
				current.height === Math.round(box.height)
					? current
					: { width: Math.round(box.width), height: Math.round(box.height) },
			)
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(wrap)
		return () => observer.disconnect()
	}, [])

	const dpr =
		typeof window === "undefined"
			? 1
			: Math.min(window.devicePixelRatio || 1, 2)

	const points = useMemo(() => {
		const radius = Math.max(0, Math.min(size.width, size.height) / 2 - 14)
		const px = new Float32Array(layout.x.length)
		const py = new Float32Array(layout.y.length)
		for (let i = 0; i < px.length; i++) {
			px[i] = size.width / 2 + (layout.x[i] as number) * radius
			py[i] = size.height / 2 + (layout.y[i] as number) * radius
		}
		return { px, py, radius }
	}, [layout, size])

	const grid = useMemo(() => new NodeGrid(points.px, points.py, 24), [points])

	// Static layer: cached until the data, layout or size changes.
	useEffect(() => {
		const canvas = staticRef.current
		const ctx = canvas?.getContext("2d")
		if (!canvas || !ctx || size.width === 0) {
			return
		}
		const startedAt = performance.now()
		canvas.width = Math.round(size.width * dpr)
		canvas.height = Math.round(size.height * dpr)
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
		ctx.clearRect(0, 0, size.width, size.height)
		ctx.strokeStyle = "rgba(185, 205, 201, 0.12)"
		ctx.lineWidth = 1
		for (const ring of [0.34, 0.67, 1]) {
			ctx.beginPath()
			ctx.arc(
				size.width / 2,
				size.height / 2,
				points.radius * ring,
				0,
				Math.PI * 2,
			)
			ctx.stroke()
		}
		ctx.strokeStyle = "rgba(185, 205, 201, 0.2)"
		ctx.lineWidth = 0.7
		ctx.beginPath()
		for (const edge of graph.edges) {
			ctx.moveTo(points.px[edge.a] as number, points.py[edge.a] as number)
			ctx.lineTo(points.px[edge.b] as number, points.py[edge.b] as number)
		}
		ctx.stroke()
		const byColor = new Map<string, number[]>()
		graph.nodes.forEach((node, i) => {
			const bucket = byColor.get(node.color)
			if (bucket) {
				bucket.push(i)
			} else {
				byColor.set(node.color, [i])
			}
		})
		for (const [color, members] of byColor) {
			ctx.fillStyle = color
			ctx.beginPath()
			for (const i of members) {
				const r = nodeRadius(
					(graph.nodes[i] as { degree: number }).degree,
					size.width,
				)
				ctx.moveTo((points.px[i] as number) + r, points.py[i] as number)
				ctx.arc(
					points.px[i] as number,
					points.py[i] as number,
					r,
					0,
					Math.PI * 2,
				)
			}
			ctx.fill()
		}
		ctx.strokeStyle = SIGNAL
		ctx.lineWidth = 2
		graph.nodes.forEach((node, i) => {
			if (node.contradicted) {
				ctx.beginPath()
				ctx.arc(
					points.px[i] as number,
					points.py[i] as number,
					nodeRadius(node.degree, size.width) + 4,
					0,
					Math.PI * 2,
				)
				ctx.stroke()
			}
		})
		countDraw(canvas)
		canvas.dataset.drawMs = (performance.now() - startedAt).toFixed(1)
		if (performance.getEntriesByName("demo-graph-drawn").length === 0) {
			performance.mark("demo-graph-drawn")
		}
	}, [graph, points, size, dpr])

	// Live layer: rings and labels only.
	useEffect(() => {
		const canvas = liveRef.current
		const ctx = canvas?.getContext("2d")
		if (!canvas || !ctx || size.width === 0) {
			return
		}
		canvas.width = Math.round(size.width * dpr)
		canvas.height = Math.round(size.height * dpr)
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
		ctx.clearRect(0, 0, size.width, size.height)
		const marked: number[] = []
		const pinnedIndex = pinned === null ? undefined : graph.index.get(pinned)
		for (const slug of highlight) {
			const index = graph.index.get(slug)
			if (index !== undefined) {
				marked.push(index)
			}
		}
		const rings = new Set<number>(marked)
		if (pinnedIndex !== undefined) {
			rings.add(pinnedIndex)
		}
		if (hovered >= 0) {
			rings.add(hovered)
		}
		ctx.lineWidth = 2.5
		for (const index of rings) {
			const node = graph.nodes[index]
			if (!node) {
				continue
			}
			ctx.strokeStyle = index === pinnedIndex ? SIGNAL : SCOPE_INK
			ctx.beginPath()
			ctx.arc(
				points.px[index] as number,
				points.py[index] as number,
				nodeRadius(node.degree, size.width) + 6,
				0,
				Math.PI * 2,
			)
			ctx.stroke()
		}
		ctx.font = LABEL_FONT
		ctx.textBaseline = "middle"
		const labelled = [
			...new Set([
				...(pinnedIndex !== undefined ? [pinnedIndex] : []),
				...(hovered >= 0 ? [hovered] : []),
				...marked.slice(0, MAX_LABELS),
			]),
		]
		const taken: Array<[number, number, number, number]> = []
		for (const index of labelled) {
			const node = graph.nodes[index]
			if (!node) {
				continue
			}
			const text =
				node.title.length > 28 ? `${node.title.slice(0, 27)}…` : node.title
			const width = ctx.measureText(text).width + 12
			const x = Math.min(
				Math.max(4, (points.px[index] as number) + 12),
				Math.max(4, size.width - width - 4),
			)
			const y = Math.min(
				Math.max(14, (points.py[index] as number) - 14),
				size.height - 14,
			)
			// A label that would sit on an earlier one is skipped: the ring still marks the page.
			if (
				taken.some(
					([tx, ty, tw]) =>
						x < tx + tw && tx < x + width && Math.abs(y - ty) < 22,
				)
			) {
				continue
			}
			taken.push([x, y, width, 22])
			ctx.fillStyle = "rgba(10, 30, 36, 0.9)"
			ctx.fillRect(x, y - 11, width, 22)
			ctx.fillStyle = SCOPE_INK
			ctx.fillText(text, x + 6, y)
		}
		countDraw(canvas)
	}, [graph, points, size, dpr, highlight, pinned, hovered])

	const nodeAt = (
		event: { clientX: number; clientY: number },
		reach: number,
	): number => {
		const box = wrapRef.current?.getBoundingClientRect()
		return box
			? grid.nearest(event.clientX - box.left, event.clientY - box.top, reach)
			: -1
	}

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: pinning by click is the pointer path; the page picker beside the map is the keyboard path
		<div
			ref={wrapRef}
			className={fill ? styles.canvasFill : styles.canvasWrap}
			role="img"
			aria-label={label}
			onPointerMove={(event) => {
				if (event.pointerType === "mouse") {
					setHovered(nodeAt(event, MOUSE_REACH))
				}
			}}
			onPointerLeave={() => setHovered(-1)}
			onClick={(event) => {
				const reach =
					(event.nativeEvent as PointerEvent).pointerType === "touch"
						? TOUCH_REACH
						: MOUSE_REACH
				const index = nodeAt(event, reach)
				const node = index >= 0 ? graph.nodes[index] : undefined
				if (node) {
					onPin(node.slug)
				}
			}}
		>
			<canvas ref={staticRef} className={styles.canvas} data-layer="static" />
			<canvas ref={liveRef} className={styles.canvas} data-layer="live" />
		</div>
	)
}
