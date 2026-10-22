"use client"

import { useGSAP } from "@gsap/react"
import { OrbitControls } from "@react-three/drei"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import gsap from "gsap"
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import * as THREE from "three"
import {
	FOV_DEGREES,
	HOME_DISTANCE,
	type Vec3,
	copyPose,
} from "../../../lib/demo-data/camera-pose.js"
import { layoutSphere } from "../../../lib/demo-data/graph-layout3.js"
import {
	type Degraded,
	createFrameMonitor,
} from "../../../lib/demo-data/scene-gate.js"
import {
	type SceneStore,
	createSceneStore,
} from "../../../lib/demo-data/scene-store.js"
import type { Graph } from "../../../lib/demo-data/views.js"
import { createFlight } from "../motion/fly.js"
import {
	Label,
	LabelLayer,
	LitEdge,
	Ring,
	SCOPE_INK,
	SIGNAL,
} from "./scene-marks.js"
import { usePicking } from "./use-picking.js"

gsap.registerPlugin(useGSAP)

const SCOPE = "#143038"
const EDGE = "#b9cdc9"
const MAX_LABELS = 6

/** Where tests and measurements reach the live scene; nothing else reads it. */
export const SCENE_SEAM = Symbol.for("mdbrain.demo.scene")
export type SceneSeam = {
	screenOf: (slug: string) => { x: number; y: number } | null
	state: () => {
		nodes: number
		edges: number
		frames: number
		/** Whether the framed pair has a stored link between them; null when none is framed. */
		link: boolean | null
		pose: SceneStore["pose"]
		drift: number
		lit: number
		held: boolean
		listeners: number
	}
}

/** World units: the brain is a sphere of radius 1. */
const nodeRadius = (degree: number) => 0.016 + Math.min(degree, 14) * 0.0026

export type SceneProps = {
	graph: Graph
	highlight: ReadonlySet<string>
	pinned: string | null
	onPin: (slug: string) => void
	/** The pair the camera frames; null keeps the whole brain in view. */
	frame: readonly [string, string] | null
	/** True when the viewer may turn the scene by dragging. */
	orbit: boolean
	onFirstFrame: () => void
	onDegrade: (why: Degraded) => void
}

type WorldProps = Omit<SceneProps, "orbit"> & {
	store: SceneStore
	flight: ReturnType<typeof createFlight>
}

function World({
	graph,
	highlight,
	pinned,
	onPin,
	frame,
	store,
	flight,
	onFirstFrame,
	onDegrade,
}: WorldProps) {
	const { invalidate, camera, size, gl } = useThree()
	const group = useRef<THREE.Group>(null)
	const instances = useRef<THREE.InstancedMesh>(null)
	const [hovered, setHovered] = useState(-1)
	const monitor = useMemo(() => createFrameMonitor(), [])
	const frames = useRef(0)
	const arrived = useRef(false)
	const aspect =
		size.width > 0 && size.height > 0 ? size.width / size.height : 1
	const aspectNow = useRef(aspect)
	aspectNow.current = aspect

	const spots = useMemo(() => {
		const sphere = layoutSphere(
			graph.nodes,
			graph.hub,
			graph.groups.map((entry) => entry.id),
		)
		const flat = new Float32Array(graph.nodes.length * 3)
		for (let i = 0; i < graph.nodes.length; i++) {
			flat[i * 3] = sphere.x[i] as number
			flat[i * 3 + 1] = sphere.y[i] as number
			flat[i * 3 + 2] = sphere.z[i] as number
		}
		return flat
	}, [graph])
	const at = useCallback(
		(i: number): Vec3 => [
			spots[i * 3] as number,
			spots[i * 3 + 1] as number,
			spots[i * 3 + 2] as number,
		],
		[spots],
	)

	useLayoutEffect(() => {
		const mesh = instances.current
		if (!mesh) {
			return
		}
		const matrix = new THREE.Matrix4()
		const still = new THREE.Quaternion()
		const place = new THREE.Vector3()
		const scale = new THREE.Vector3()
		const color = new THREE.Color()
		graph.nodes.forEach((node, i) => {
			const radius = nodeRadius(node.degree)
			place.set(...at(i))
			scale.set(radius, radius, radius)
			mesh.setMatrixAt(i, matrix.compose(place, still, scale))
			mesh.setColorAt(i, color.set(node.color))
		})
		mesh.instanceMatrix.needsUpdate = true
		if (mesh.instanceColor) {
			mesh.instanceColor.needsUpdate = true
		}
		invalidate()
	}, [graph, at, invalidate])

	const edges = useMemo(() => {
		const positions = new Float32Array(graph.edges.length * 6)
		graph.edges.forEach((edge, k) => {
			positions.set(at(edge.a), k * 6)
			positions.set(at(edge.b), k * 6 + 3)
		})
		const geometry = new THREE.BufferGeometry()
		geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
		return geometry
	}, [graph, at])
	useEffect(() => () => edges.dispose(), [edges])

	const pair = useMemo(() => {
		const a = frame ? graph.index.get(frame[0]) : undefined
		const b = frame ? graph.index.get(frame[1]) : undefined
		if (a === undefined || b === undefined || a === b) {
			return null
		}
		const link = graph.edges.some(
			(edge) =>
				(edge.a === a && edge.b === b) || (edge.a === b && edge.b === a),
		)
		return { a: at(a), b: at(b), link }
	}, [frame, graph, at])

	// GSAP alone moves the pose while the camera is framed; the drift is held
	// for the flight, so no property has two writers.
	useGSAP(
		() => {
			if (pair) {
				flight.frame(pair.a, pair.b, aspectNow.current, pair.link)
			} else {
				flight.release()
			}
		},
		{ dependencies: [pair, flight] },
	)

	useEffect(() => {
		store.setAspect(aspect)
		invalidate()
	}, [store, aspect, invalidate])
	useEffect(() => {
		store.wake()
		const stop = store.subscribe(invalidate)
		invalidate()
		return stop
	}, [store, invalidate])

	useEffect(() => {
		const element = gl.domElement
		const lost = (event: Event) => {
			event.preventDefault()
			onDegrade("context-lost")
		}
		element.addEventListener("webglcontextlost", lost)
		return () => element.removeEventListener("webglcontextlost", lost)
	}, [gl, onDegrade])

	const screenOf = usePicking({
		graph,
		spots,
		group,
		onHover: setHovered,
		onPin,
	})
	useEffect(() => {
		const seam: SceneSeam = {
			screenOf,
			state: () => ({
				nodes: instances.current?.count ?? 0,
				edges: edges.getAttribute("position").count / 2,
				frames: frames.current,
				link: pair?.link ?? null,
				pose: copyPose(store.pose),
				drift: store.drift,
				lit: store.lit,
				held: store.isHeld(),
				listeners: store.listenerCount(),
			}),
		}
		const host = window as unknown as Record<symbol, unknown>
		host[SCENE_SEAM] = seam
		return () => {
			if (host[SCENE_SEAM] === seam) {
				// biome-ignore lint/performance/noDelete: the seam must be absent, not undefined, once the scene is gone
				delete host[SCENE_SEAM]
			}
		}
	}, [screenOf, store, edges, pair])

	useFrame((state, delta) => {
		const holder = group.current
		if (!holder) {
			return
		}
		const drifting = store.advance(delta)
		const pose = store.pose
		holder.rotation.y = pose.yaw + store.drift
		holder.position.set(pose.gx, pose.gy, pose.gz)
		camera.position.setLength(pose.d)
		camera.lookAt(0, 0, 0)
		store.azimuth = Math.atan2(camera.position.x, camera.position.z)
		frames.current += 1
		if (!arrived.current) {
			arrived.current = true
			onFirstFrame()
		}
		if (drifting) {
			state.invalidate()
		}
		// Only frames that run back to back say how fast the device is; a frame
		// asked for by a hover says nothing about it.
		if (drifting || flight.active()) {
			if (monitor.feed(delta, document.hidden) === "slow") {
				onDegrade("slow")
			}
		} else {
			monitor.reset()
		}
	})

	const marked = useMemo(
		() =>
			[...highlight].flatMap((slug) => {
				const index = graph.index.get(slug)
				return index === undefined ? [] : [index]
			}),
		[highlight, graph],
	)
	const pinnedIndex = pinned === null ? undefined : graph.index.get(pinned)
	const ringed = useMemo(() => {
		const set = new Set<number>(marked)
		if (pinnedIndex !== undefined) {
			set.add(pinnedIndex)
		}
		if (hovered >= 0) {
			set.add(hovered)
		}
		return [...set]
	}, [marked, pinnedIndex, hovered])
	const named = useMemo(
		() => [
			...new Set([
				...(pinnedIndex !== undefined ? [pinnedIndex] : []),
				...(hovered >= 0 ? [hovered] : []),
				...marked.slice(0, MAX_LABELS),
			]),
		],
		[marked, pinnedIndex, hovered],
	)
	const flagged = useMemo(
		() => graph.nodes.flatMap((node, i) => (node.contradicted ? [i] : [])),
		[graph],
	)
	const degreeOf = (i: number) => (graph.nodes[i] as { degree: number }).degree

	return (
		<group ref={group}>
			<instancedMesh
				ref={instances}
				args={[undefined, undefined, graph.nodes.length]}
				frustumCulled={false}
			>
				<sphereGeometry args={[1, 14, 10]} />
				<meshBasicMaterial />
			</instancedMesh>
			<lineSegments geometry={edges} frustumCulled={false}>
				<lineBasicMaterial
					color={EDGE}
					transparent
					opacity={0.22}
					depthWrite={false}
				/>
			</lineSegments>
			{flagged.map((i) => (
				<Ring
					key={`flag-${i}`}
					at={at(i)}
					radius={nodeRadius(degreeOf(i)) * 1.55}
					color={SIGNAL}
				/>
			))}
			{ringed.map((i) => (
				<Ring
					key={`ring-${i}`}
					at={at(i)}
					radius={nodeRadius(degreeOf(i)) * 2.15}
					color={i === pinnedIndex ? SIGNAL : SCOPE_INK}
				/>
			))}
			{pair?.link ? <LitEdge a={pair.a} b={pair.b} store={store} /> : null}
			{named.map((i) => (
				<Label
					key={`name-${i}`}
					at={at(i)}
					text={(graph.nodes[i] as { title: string }).title}
					group={group}
				/>
			))}
		</group>
	)
}

/** drei's OrbitControls writes `touch-action` on the element it listens to, and
 * resets it to `auto` when it unmounts, after React has applied the new style.
 * This sets it last, so a map that is not being turned never traps a swipe. */
function TouchAction({ orbit }: { orbit: boolean }) {
	const connected = useThree((state) => state.events.connected)
	const fallback = useThree((state) => state.gl.domElement)
	useEffect(() => {
		const element = (connected as HTMLElement | undefined) ?? fallback
		element.style.touchAction = orbit ? "none" : "pan-y"
	}, [connected, fallback, orbit])
	return null
}

/** The 3D brain: one instanced mesh for the pages and one line set for the
 * links, rendered only when something changes. */
export function GraphScene({ orbit, ...rest }: SceneProps) {
	const [store] = useState(() => createSceneStore(1))
	const [flight] = useState(() => createFlight(store))
	useEffect(
		() => () => {
			flight.kill()
			store.dispose()
		},
		[flight, store],
	)
	const camera = useMemo(
		() => ({
			fov: FOV_DEGREES,
			near: 0.05,
			far: 30,
			position: [0, 0.3, HOME_DISTANCE] as [number, number, number],
		}),
		[],
	)
	return (
		<Canvas
			frameloop="demand"
			flat
			dpr={[1, 1.75]}
			camera={camera}
			gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
			resize={{ scroll: false }}
		>
			<TouchAction orbit={orbit} />
			<LabelLayer />
			<fog attach="fog" args={[SCOPE, 2.2, 5.4]} />
			<World {...rest} store={store} flight={flight} />
			{orbit ? (
				<OrbitControls
					makeDefault
					enablePan={false}
					enableZoom={false}
					enableDamping
					dampingFactor={0.08}
					rotateSpeed={0.55}
					minPolarAngle={1.0}
					maxPolarAngle={1.9}
					onStart={() => store.rest()}
				/>
			) : null}
		</Canvas>
	)
}
