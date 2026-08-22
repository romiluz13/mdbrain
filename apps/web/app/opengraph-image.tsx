import { ImageResponse } from "next/og"

export const alt =
	"MDBrain maps sources, governed knowledge, long-term memory, MongoDB retrieval, and evidence into one living context system."
export const size = {
	width: 1200,
	height: 630,
}
export const contentType = "image/png"

const nodes = [
	{ label: "SOURCES", x: 655, y: 112 },
	{ label: "IDENTITY", x: 865, y: 92 },
	{ label: "WIKI", x: 1030, y: 222 },
	{ label: "MEMORY", x: 1015, y: 416 },
	{ label: "MONGODB", x: 807, y: 503 },
	{ label: "CONTEXT", x: 626, y: 378 },
]

export default function OpenGraphImage() {
	return new ImageResponse(
		<div
			style={{
				position: "relative",
				display: "flex",
				width: "100%",
				height: "100%",
				overflow: "hidden",
				background: "#052e2b",
				color: "#fffdf6",
				fontFamily: "Arial, sans-serif",
			}}
		>
			<div
				style={{
					position: "absolute",
					inset: 0,
					display: "flex",
					backgroundImage:
						"linear-gradient(rgba(200,242,75,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(200,242,75,.055) 1px, transparent 1px)",
					backgroundSize: "34px 34px",
				}}
			/>
			<div
				style={{
					position: "absolute",
					top: 48,
					left: 55,
					display: "flex",
					alignItems: "center",
					gap: 13,
					fontSize: 20,
					fontWeight: 800,
					letterSpacing: "-0.02em",
				}}
			>
				<span
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						width: 34,
						height: 34,
						border: "2px solid #c8f24b",
						color: "#c8f24b",
						fontSize: 16,
					}}
				>
					M
				</span>
				MDBRAIN
			</div>
			<div
				style={{
					position: "absolute",
					top: 150,
					left: 55,
					display: "flex",
					flexDirection: "column",
					width: 570,
				}}
			>
				<span
					style={{
						display: "flex",
						width: 214,
						marginBottom: 22,
						padding: "7px 10px",
						background: "#c8f24b",
						color: "#052e2b",
						fontSize: 13,
						fontWeight: 800,
						letterSpacing: "0.08em",
					}}
				>
					OPEN SYSTEM BLUEPRINT
				</span>
				<h1
					style={{
						display: "flex",
						flexDirection: "column",
						margin: 0,
						fontSize: 65,
						letterSpacing: "-0.06em",
						lineHeight: 0.94,
					}}
				>
					<span>Facts change.</span>
					<span style={{ display: "flex", color: "#c8f24b" }}>
						Memory should know.
					</span>
				</h1>
				<p
					style={{
						display: "flex",
						marginTop: 30,
						color: "rgba(255,255,255,.62)",
						fontSize: 19,
						lineHeight: 1.45,
					}}
				>
					Governed company knowledge + long-term agent memory, built as one
					inspectable MongoDB system.
				</p>
			</div>
			<div
				style={{
					position: "absolute",
					top: 110,
					left: 655,
					display: "flex",
					width: 420,
					height: 420,
					border: "1px solid rgba(200,242,75,.32)",
					borderRadius: 999,
				}}
			/>
			<div
				style={{
					position: "absolute",
					top: 205,
					left: 750,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: 230,
					height: 230,
					border: "1px solid rgba(79,124,255,.5)",
					borderRadius: 999,
					background: "rgba(5,46,43,.84)",
					color: "#c8f24b",
					fontSize: 29,
					fontWeight: 700,
					textAlign: "center",
				}}
			>
				LIVING
				<br />
				CONTEXT
			</div>
			{nodes.map((node, index) => (
				<div
					key={node.label}
					style={{
						position: "absolute",
						top: node.y,
						left: node.x,
						display: "flex",
						gap: 8,
						padding: "9px 12px",
						border: "1px solid rgba(255,255,255,.28)",
						background: "#073f3a",
						color: index === 4 ? "#c8f24b" : "#fffdf6",
						fontSize: 12,
						fontWeight: 700,
						letterSpacing: "0.08em",
					}}
				>
					{String(index + 1).padStart(2, "0")} / {node.label}
				</div>
			))}
			<div
				style={{
					position: "absolute",
					right: 55,
					bottom: 36,
					display: "flex",
					color: "rgba(255,255,255,.5)",
					fontSize: 12,
					letterSpacing: "0.07em",
				}}
			>
				SOURCES → GOVERNANCE → MEMORY → EVIDENCE
			</div>
		</div>,
		{
			...size,
		},
	)
}
