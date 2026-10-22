"use client"

import { Billboard } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import { type RefObject, useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import {
	CSS2DObject,
	CSS2DRenderer,
} from "three/addons/renderers/CSS2DRenderer.js"
import type { Vec3 } from "../../../lib/demo-data/camera-pose.js"
import { GRAPH_INK } from "../../../lib/demo-data/graph-ink.js"
import type { SceneStore } from "../../../lib/demo-data/scene-store.js"
import styles from "../graph.module.css"

/** A ring that always faces the camera, around the page at `at`. */
export function Ring({
	at,
	radius,
	color,
}: {
	at: Vec3
	radius: number
	color: string
}) {
	return (
		<Billboard position={at}>
			<mesh scale={radius}>
				<ringGeometry args={[1, 1.16, 48]} />
				<meshBasicMaterial color={color} transparent depthWrite={false} />
			</mesh>
		</Billboard>
	)
}

/** The layer the page titles are drawn into, over the canvas. Plain DOM that
 * three's CSS2DRenderer places each frame: a title needs no React root of its
 * own, so leaving the chapter takes it away in step with the canvas. The scene
 * is drawn here too, because the titles must be placed after the scene has
 * moved for the frame. */
export function LabelLayer() {
	const gl = useThree((state) => state.gl)
	const width = useThree((state) => state.size.width)
	const height = useThree((state) => state.size.height)
	const layer = useMemo(() => new CSS2DRenderer(), [])
	useEffect(() => {
		const element = layer.domElement
		element.className = styles.labelLayer ?? ""
		gl.domElement.parentElement?.appendChild(element)
		return () => element.remove()
	}, [gl, layer])
	useEffect(() => {
		layer.setSize(width, height)
	}, [layer, width, height])
	useFrame(({ gl: renderer, scene, camera }) => {
		renderer.render(scene, camera)
		layer.render(scene, camera)
	}, 1)
	return null
}

/** A page's title beside its dot; it moves to the dot's other side near the
 * stage's right edge so it is never cut off. */
export function Label({
	at,
	text,
	group,
}: {
	at: Vec3
	text: string
	group: RefObject<THREE.Group | null>
}) {
	const camera = useThree((state) => state.camera)
	const point = useMemo(() => new THREE.Vector3(), [])
	const [x, y, z] = at
	const { anchor, span } = useMemo(() => {
		const anchor = document.createElement("div")
		const span = document.createElement("span")
		span.className = styles.sceneLabel ?? ""
		span.textContent = text.length > 28 ? `${text.slice(0, 27)}…` : text
		anchor.append(span)
		const anchorObject = new CSS2DObject(anchor)
		anchorObject.position.set(x, y, z)
		return { anchor: anchorObject, span }
	}, [x, y, z, text])
	useFrame(() => {
		const holder = group.current
		if (!holder) {
			return
		}
		point.set(x, y, z).applyMatrix4(holder.matrixWorld)
		point.project(camera)
		const side = point.x > 0.3 ? "left" : "right"
		if (span.dataset.side !== side) {
			span.dataset.side = side
		}
	})
	return <primitive object={anchor} />
}

const UP = new THREE.Vector3(0, 1, 0)

/** The stored link between the framed pages, drawn in the signal color and
 * grown from the first page to the second as `store.lit` goes from 0 to 1. */
export function LitEdge({
	a,
	b,
	store,
}: {
	a: Vec3
	b: Vec3
	store: SceneStore
}) {
	const mesh = useRef<THREE.Mesh>(null)
	const { start, toward, length, turn } = useMemo(() => {
		const start = new THREE.Vector3(...a)
		const toward = new THREE.Vector3(...b).sub(start)
		const length = toward.length()
		const turn = new THREE.Quaternion().setFromUnitVectors(
			UP,
			toward.clone().normalize(),
		)
		return { start, toward, length, turn }
	}, [a, b])
	useFrame(() => {
		const body = mesh.current
		if (!body) {
			return
		}
		const grown = store.lit
		body.visible = grown > 0.001
		body.position.copy(start).addScaledVector(toward, grown / 2)
		body.scale.set(1, Math.max(length * grown, 1e-4), 1)
		body.quaternion.copy(turn)
	})
	return (
		<mesh ref={mesh} visible={false}>
			<cylinderGeometry args={[0.0045, 0.0045, 1, 10, 1]} />
			<meshBasicMaterial color={GRAPH_INK.signal} />
		</mesh>
	)
}
