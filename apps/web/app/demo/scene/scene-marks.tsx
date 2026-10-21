"use client"

import { Billboard, Html } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import { type RefObject, useMemo, useRef } from "react"
import * as THREE from "three"
import type { Vec3 } from "../../../lib/demo-data/camera-pose.js"
import type { SceneStore } from "../../../lib/demo-data/scene-store.js"
import styles from "../graph.module.css"

export const SIGNAL = "#e5502b"
export const SCOPE_INK = "#f6f8f5"

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
	const ref = useRef<HTMLSpanElement>(null)
	const point = useMemo(() => new THREE.Vector3(), [])
	useFrame(() => {
		const span = ref.current
		const holder = group.current
		if (!span || !holder) {
			return
		}
		point.set(at[0], at[1], at[2]).applyMatrix4(holder.matrixWorld)
		point.project(camera)
		const side = point.x > 0.3 ? "left" : "right"
		if (span.dataset.side !== side) {
			span.dataset.side = side
		}
	})
	return (
		<Html position={at} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
			<span ref={ref} className={styles.sceneLabel}>
				{text.length > 28 ? `${text.slice(0, 27)}…` : text}
			</span>
		</Html>
	)
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
			<meshBasicMaterial color={SIGNAL} />
		</mesh>
	)
}
