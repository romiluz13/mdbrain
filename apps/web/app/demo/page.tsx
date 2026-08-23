import type { Metadata } from "next"
import Link from "next/link"
import { demoScenario } from "../../lib/marketing/demo-scenario.js"
import { RetrievalAutopsy } from "./components/retrieval-autopsy.js"
import styles from "./demo.module.css"

export const metadata: Metadata = {
	title: "Retrieval Autopsy | MDBrain",
	description:
		"Watch the same coding-agent question fail with similarity-only retrieval and succeed with governed, inspectable context.",
	openGraph: {
		title: "Retrieval Autopsy | MDBrain",
		description:
			"A guided synthetic simulation of governed retrieval for coding agents.",
		url: "/demo",
		siteName: "MDBrain",
		images: ["/opengraph-image"],
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "Retrieval Autopsy | MDBrain",
		description:
			"A guided synthetic simulation of governed retrieval for coding agents.",
		images: ["/opengraph-image"],
	},
}

const repository = "https://github.com/romiluz13/mdbrain"

const comparison = [
	["Target", "Similar answer", "Eligible answer"],
	["Lifecycle", "Dead page ranked first", "Superseded page excluded"],
	["Conflict", "Buried in the result set", "Potential conflict exposed"],
	["Context", "One matching chunk", "Connected supporting evidence"],
	["Delivery", "Citation only", "Inspectable context bundle"],
] as const

export default function DemoPage() {
	return (
		<main className={styles.page}>
			<header className={styles.header}>
				<Link className={styles.brand} href="/" aria-label="MDBrain home">
					<svg viewBox="0 0 32 32" aria-hidden="true">
						<path d="M5 25V7l11 7 11-7v18l-11-7-11 7Z" />
					</svg>
					<span>MDBrain</span>
				</Link>
				<p>Sales demo / Retrieval quality</p>
				<nav aria-label="Demo navigation">
					<Link href="/">System atlas</Link>
					<Link href="/compare">Field guide</Link>
					<a href={repository}>Source ↗</a>
				</nav>
			</header>

			<section className={styles.hero}>
				<div className={styles.heroIndex} aria-hidden="true">
					<span>Case</span>
					<strong>001</strong>
					<small>stale evidence</small>
				</div>
				<div className={styles.heroCopy}>
					<p className={styles.eyebrow}>
						<span>Guided synthetic simulation</span>
						10-minute customer story
					</p>
					<h1>
						Your coding agent found the answer.
						<em>It was six months out of date.</em>
					</h1>
					<p>
						Watch one ordinary engineering question become a retrieval autopsy.
						Same query, same company knowledge, radically different evidence.
					</p>
					<div className={styles.heroPrompt}>
						<span>Question loaded</span>
						<p>“{demoScenario.question}”</p>
						<a href="#autopsy">Run retrieval →</a>
					</div>
				</div>
				<aside className={styles.heroAside}>
					<p>The failure mode</p>
					<strong>Confidently wrong</strong>
					<span>
						Similarity finds what sounds right. Governed lifecycle state,
						permissions, and evidence determine what the agent may trust.
					</span>
				</aside>
			</section>

			<div id="autopsy">
				<RetrievalAutopsy />
			</div>

			<section className={styles.verdict} aria-labelledby="verdict-heading">
				<div className={styles.verdictLead}>
					<p className={styles.eyebrow}>The verdict</p>
					<h2 id="verdict-heading">
						The dangerous retrieval failure is not no answer.
						<em>It is the wrong answer with confidence.</em>
					</h2>
				</div>
				<div className={styles.verdictTable}>
					<div className={styles.verdictHeader}>
						<span>Decision</span>
						<strong>Ordinary retrieval</strong>
						<strong>MDBrain</strong>
					</div>
					{comparison.map(([label, baseline, mdbrain]) => (
						<div className={styles.verdictRow} key={label}>
							<span>{label}</span>
							<p>{baseline}</p>
							<p>{mdbrain}</p>
						</div>
					))}
				</div>
			</section>

			<section className={styles.close}>
				<p>One MongoDB-native evidence path</p>
				<h2>
					Make your coding agent
					<em>show its work.</em>
				</h2>
				<div>
					<a className={styles.primaryButton} href={`${repository}#quickstart`}>
						Open GitHub quickstart ↗
					</a>
					<Link className={styles.secondaryButton} href="/#architecture">
						Trace the architecture
					</Link>
					<Link className={styles.secondaryButton} href="/compare">
						Read the field guide
					</Link>
				</div>
				<small>
					Open source. Synthetic demo. No customer data. Every capability linked
					to code.
				</small>
			</section>
		</main>
	)
}
