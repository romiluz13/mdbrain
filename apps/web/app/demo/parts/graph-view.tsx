"use client"

import dynamic from "next/dynamic"
import {
	Component,
	type ReactNode,
	useCallback,
	useEffect,
	useState,
	useSyncExternalStore,
} from "react"
import type { Layout } from "../../../lib/demo-data/graph-layout.js"
import { chooseView, type Degraded } from "../../../lib/demo-data/scene-gate.js"
import type { Graph } from "../../../lib/demo-data/views.js"
import { describeView } from "../../../lib/demo-data/view-copy.js"
import styles from "../graph.module.css"
import { useReducedMotion } from "../motion/use-reduced-motion.js"
import type { SceneProps } from "../scene/graph-scene.js"
import { useViewState, viewStore } from "../scene/view-store.js"
import { GraphCanvas } from "./graph-canvas.js"

// The 3D island is its own chunk: it is fetched only once the flat map has
// drawn and the page is idle, and never on the server.
const Scene = dynamic<SceneProps>(
	() => import("../scene/graph-scene.js").then((module) => module.GraphScene),
	{ ssr: false, loading: () => null },
)

type Props = {
	graph: Graph
	layout: Layout
	highlight: ReadonlySet<string>
	pinned: string | null
	onPin: (slug: string) => void
	label: string
	/** The pair of pages the 3D camera frames; null keeps the whole brain in view. */
	frame?: readonly [string, string] | null
}

const COARSE = "(pointer: coarse)"

function subscribeCoarse(listener: () => void): () => void {
	const query = window.matchMedia(COARSE)
	query.addEventListener("change", listener)
	return () => query.removeEventListener("change", listener)
}

const isCoarse = () => window.matchMedia(COARSE).matches

class SceneBoundary extends Component<
	{ children: ReactNode; onError: () => void },
	{ failed: boolean }
> {
	state = { failed: false }
	static getDerivedStateFromError() {
		return { failed: true }
	}
	componentDidCatch() {
		this.props.onError()
	}
	render() {
		return this.state.failed ? null : this.props.children
	}
}

/** One map, two ways to see it. The flat map is on screen at once; the 3D map
 * is loaded after it, laid over it, and takes over once its first frame is
 * drawn. Anything that stops 3D (no WebGL, reduced motion, a slow device, a lost
 * context) leaves the flat map showing, never an empty box. */
export function GraphView({ frame = null, ...canvas }: Props) {
	const { graph } = canvas
	const view = useViewState()
	const reduced = useReducedMotion()
	const coarse = useSyncExternalStore(subscribeCoarse, isCoarse, () => false)
	const [settled, setSettled] = useState(false)
	const [drawn, setDrawn] = useState(false)
	const [turning, setTurning] = useState(false)

	useEffect(() => {
		let second = 0
		let cancelArm = () => {}
		const first = requestAnimationFrame(() => {
			second = requestAnimationFrame(() => {
				setSettled(true)
				const arm = () => viewStore.arm()
				if (typeof window.requestIdleCallback === "function") {
					const idle = window.requestIdleCallback(arm, { timeout: 1500 })
					cancelArm = () => window.cancelIdleCallback(idle)
				} else {
					const timer = setTimeout(arm, 200)
					cancelArm = () => clearTimeout(timer)
				}
			})
		})
		return () => {
			cancelAnimationFrame(first)
			cancelAnimationFrame(second)
			cancelArm()
		}
	}, [])

	const choice = chooseView({
		webgl: view.webgl,
		reducedMotion: reduced,
		preference: view.preference,
		nodes: graph.nodes.length,
		edges: graph.edges.length,
		degraded: view.degraded,
	})
	const show3d = settled && choice.view === "3d"

	useEffect(() => {
		if (!show3d) {
			setDrawn(false)
			setTurning(false)
		}
	}, [show3d])

	const { status, action } = describeView(choice, { coarse, drawn })

	const onFirstFrame = useCallback(() => {
		setDrawn(true)
		performance.mark("demo-scene-first-frame")
	}, [])
	const onDegrade = useCallback((why: Degraded) => viewStore.degrade(why), [])
	const onFailure = useCallback(() => viewStore.degrade("failed"), [])

	return (
		<div className={styles.view}>
			<div
				className={styles.viewBox}
				data-wide="true"
				data-view={show3d ? "3d" : "2d"}
				data-drawn={(show3d && drawn) || undefined}
			>
				<div
					className={styles.flat}
					data-covered={(show3d && drawn) || undefined}
				>
					<GraphCanvas {...canvas} fill />
				</div>
				{show3d ? (
					<div
						className={styles.sceneLayer}
						role="img"
						aria-label={canvas.label}
						data-testid="scene-layer"
					>
						<SceneBoundary onError={onFailure}>
							<Scene
								graph={graph}
								highlight={canvas.highlight}
								pinned={canvas.pinned}
								onPin={canvas.onPin}
								frame={frame}
								orbit={!coarse || turning}
								onFirstFrame={onFirstFrame}
								onDegrade={onDegrade}
							/>
						</SceneBoundary>
					</div>
				) : null}
			</div>
			<div className={styles.viewBar}>
				<p
					className={styles.viewStatus}
					role="status"
					data-testid="graph-view-status"
				>
					{status}
				</p>
				<div className={styles.viewActions}>
					{show3d && coarse ? (
						<button
							type="button"
							className={styles.viewButton}
							aria-pressed={turning}
							onClick={() => setTurning((on) => !on)}
						>
							{turning ? "Done turning" : "Turn the map"}
						</button>
					) : null}
					{action ? (
						<button
							type="button"
							className={styles.viewButton}
							onClick={() => viewStore.choose(action)}
						>
							{action === "2d" ? "Switch to 2D" : "Switch to 3D"}
						</button>
					) : null}
				</div>
			</div>
		</div>
	)
}
