import type { Metadata } from "next"
import Link from "next/link"
import { namedComparisons } from "../../lib/marketing/comparisons.js"
import styles from "./compare.module.css"

export const metadata: Metadata = {
	title: "Comparison field guide | MDBrain",
	description:
		"A sourced comparison of MDBrain with company-context, agent-memory, and open-knowledge systems.",
	openGraph: {
		title: "Comparison field guide | MDBrain",
		description:
			"A sourced comparison of MDBrain with company-context, agent-memory, and open-knowledge systems.",
		url: "/compare",
		siteName: "MDBrain",
		images: ["/opengraph-image"],
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "Comparison field guide | MDBrain",
		description:
			"A sourced comparison of MDBrain with company-context, agent-memory, and open-knowledge systems.",
		images: ["/opengraph-image"],
	},
}

const categories = [
	"Company context",
	"Agent memory",
	"Open knowledge",
] as const

export default function ComparePage() {
	return (
		<main className={styles.page}>
			<header className={styles.header}>
				<Link href="/">← Return to the system atlas</Link>
				<a href="https://github.com/romiluz13/mdbrain">View source ↗</a>
			</header>

			<section className={styles.hero}>
				<p className={styles.eyebrow}>Sourced comparison / 2026 edition</p>
				<h1>
					A field guide,
					<em>not a fight card.</em>
				</h1>
				<p>
					The company-context market spans search suites, agent platforms,
					memory services, knowledge graphs, and open wiki engines. They do not
					make identical promises. This page identifies each product’s strongest
					public position, then states the MDBrain difference without declaring
					a universal winner.
				</p>
			</section>

			<aside className={styles.method}>
				<div>
					<span>Method</span>
					<strong>First-party sources only</strong>
				</div>
				<div>
					<span>Scope</span>
					<strong>Public product architecture</strong>
				</div>
				<div>
					<span>Posture</span>
					<strong>Differences, not parity claims</strong>
				</div>
				<div>
					<span>Reviewed</span>
					<strong>August 22, 2026</strong>
				</div>
			</aside>

			{categories.map((category) => {
				const comparisons = namedComparisons.filter(
					(comparison) => comparison.category === category,
				)

				return (
					<section
						className={styles.category}
						key={category}
						aria-labelledby={`category-${category.replace(" ", "-")}`}
					>
						<div className={styles.categoryHeading}>
							<p>{category}</p>
							<h2 id={`category-${category.replace(" ", "-")}`}>
								{category === "Company context" &&
									"Platforms for finding and activating company knowledge."}
								{category === "Agent memory" &&
									"Systems for durable, contextual agent recall."}
								{category === "Open knowledge" &&
									"Projects for synthesizing and traversing knowledge."}
							</h2>
						</div>

						<div className={styles.comparisonList}>
							<div className={styles.columnLabels} aria-hidden="true">
								<span>Product and position</span>
								<span>Where they are stronger</span>
								<span>Where MDBrain is different</span>
							</div>
							{comparisons.map((comparison) => (
								<article key={comparison.id}>
									<div className={styles.product}>
										<small>{comparison.category}</small>
										<h3>{comparison.name}</h3>
										<p>{comparison.positioning}</p>
									</div>
									<div className={styles.strength}>
										<span>Where they are stronger</span>
										<p>{comparison.strengths}</p>
									</div>
									<div className={styles.difference}>
										<span>Where MDBrain is different</span>
										<p>{comparison.difference}</p>
										<a href={comparison.source.href}>
											{comparison.source.label} ↗
										</a>
										<small>Verified {comparison.source.verifiedAt}</small>
									</div>
								</article>
							))}
						</div>
					</section>
				)
			})}

			<section className={styles.boundary}>
				<div>
					<p className={styles.eyebrow}>The honest boundary</p>
					<h2>MDBrain is a blueprint, not a finished buying category.</h2>
				</div>
				<div>
					<p>
						Glean, Guru, Dust, and Modus offer managed products and operational
						depth that a repository does not. Mem0, Zep, and Cognee provide
						focused memory ecosystems. OpenWiki and GraphRAG offer compelling
						knowledge-generation patterns.
					</p>
					<p>
						MDBrain’s bet is narrower: MongoDB can hold governed wiki artifacts,
						hybrid and graph retrieval, revision history, and an independent
						long-term-memory contract inside one inspectable application
						architecture.
					</p>
				</div>
			</section>

			<footer className={styles.footer}>
				<h2>Now inspect the architecture behind the claim.</h2>
				<Link href="/">Return to the Living System Atlas →</Link>
			</footer>
		</main>
	)
}
