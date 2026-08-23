import Link from "next/link"
import { ScenarioExplorer } from "./components/scenario-explorer.js"
import { SystemAtlas } from "./components/system-atlas.js"
import styles from "./landing.module.css"
import {
	architectureStages,
	proofScenarios,
} from "../lib/marketing/architecture.js"
import {
	categoryComparisons,
	comparisonRows,
} from "../lib/marketing/comparisons.js"

const repository = "https://github.com/romiluz13/mdbrain"

const fragments = [
	{
		number: "01",
		title: "Retrieval without history",
		body: "A chunk can match a question without knowing whether the source was replaced last Tuesday.",
	},
	{
		number: "02",
		title: "Memory without governance",
		body: "A useful fact can still be the wrong fact for this user, agent, role, or department.",
	},
	{
		number: "03",
		title: "Graphs without evidence",
		body: "A relationship is easy to traverse and hard to trust when the source path disappeared.",
	},
	{
		number: "04",
		title: "Wikis without recall",
		body: "Readable knowledge decays if agents cannot search, update, and deliver it in the moment.",
	},
]

const mongoCapabilities = [
	{
		name: "Document model",
		syntax: "BSON",
		body: "Pages, claims, revisions, provenance, access rules, and graph edges keep their native shape.",
	},
	{
		name: "Semantic retrieval",
		syntax: "$vectorSearch",
		body: "Meaning-based recall runs against operational knowledge with governance filters attached.",
	},
	{
		name: "Lexical retrieval",
		syntax: "$search",
		body: "Identifiers, names, exact phrases, and dates survive alongside semantic similarity.",
	},
	{
		name: "Server-side fusion",
		syntax: "$rankFusion",
		body: "Complementary result sets become one ranking without a second retrieval database.",
	},
	{
		name: "Relationship context",
		syntax: "$graphLookup",
		body: "A relevant page expands into typed, depth-aware surrounding knowledge.",
	},
	{
		name: "Governed change",
		syntax: "transactions",
		body: "Revisions, contradictions, claims, and indexes change together or not at all.",
	},
]

const evidence = [
	{
		claim: "Wiki writes retain revision history",
		status: "IMPLEMENTED",
		detail: "Transactional revision tests",
		href: `${repository}/blob/main/packages/wiki-engine/src/wiki-revisions.test.ts`,
	},
	{
		claim: "Contradictions survive duplicate filtering",
		status: "IMPLEMENTED",
		detail: "Contradiction pipeline tests",
		href: `${repository}/blob/main/packages/wiki-engine/src/wiki-contradictions.test.ts`,
	},
	{
		claim: "Reads enforce scoped governance",
		status: "IMPLEMENTED",
		detail: "Isolation and policy tests",
		href: `${repository}/blob/main/packages/wiki-engine/src/wiki-governance.test.ts`,
	},
	{
		claim: "Search combines semantic and lexical evidence",
		status: "RUNTIME-GATED",
		detail: "Atlas and local search paths",
		href: `${repository}/blob/main/packages/wiki-engine/src/wiki-search.test.ts`,
	},
	{
		claim: "Knowledge exports through OKF",
		status: "IMPLEMENTED",
		detail: "Portable interchange tests",
		href: `${repository}/blob/main/packages/wiki-engine/src/okf.test.ts`,
	},
	{
		claim: "Long-term memory is independently deployable",
		status: "EXTERNAL",
		detail: "Pinned Memongo HTTP contract",
		href: `${repository}/blob/main/packages/memory-bridge/src/memongo-http-client.ts`,
	},
]

export default function Home() {
	return (
		<main className={styles.page}>
			<header className={styles.header}>
				<Link className={styles.brand} href="/" aria-label="MDBrain home">
					<svg viewBox="0 0 32 32" aria-hidden="true">
						<path d="M5 25V7l11 7 11-7v18l-11-7-11 7Z" />
					</svg>
					<span>MDBrain</span>
				</Link>
				<nav aria-label="Primary navigation">
					<Link href="/demo">Demo</Link>
					<a href="#architecture">Architecture</a>
					<a href="#proof">Proof</a>
					<a href="#comparison">Comparison</a>
					<Link href="/compare">Field guide</Link>
				</nav>
				<a className={styles.headerCta} href={repository}>
					View source
					<span aria-hidden="true">↗</span>
				</a>
			</header>

			<section className={styles.hero}>
				<div className={styles.heroCopy}>
					<p className={styles.eyebrow}>
						<span>Open system blueprint</span>
						MongoDB-native knowledge + memory
					</p>
					<h1>
						Your AI can retrieve a fact.{" "}
						<em>Can it tell when that fact stopped being true?</em>
					</h1>
					<p className={styles.heroSummary}>
						MDBrain is an open-source architecture for governed company
						knowledge and long-term agent memory. It keeps meaning, history,
						permissions, relationships, and evidence inside one inspectable
						system.
					</p>
					<div className={styles.heroActions}>
						<Link className={styles.primaryButton} href="/demo">
							Run the retrieval autopsy
							<span aria-hidden="true">→</span>
						</Link>
						<a className={styles.secondaryButton} href="#architecture">
							Trace the architecture
						</a>
					</div>
					<ul className={styles.heroFacts} aria-label="Project facts">
						<li>
							<strong>Apache 2.0</strong>
							<span>open source</span>
						</li>
						<li>
							<strong>6 stages</strong>
							<span>source to context</span>
						</li>
						<li>
							<strong>0 black boxes</strong>
							<span>every claim linked</span>
						</li>
					</ul>
				</div>
				<SystemAtlas stages={architectureStages} />
			</section>

			<section className={styles.thesis} aria-labelledby="thesis-heading">
				<div className={styles.sectionLead}>
					<p className={styles.eyebrow}>The fragmentation tax</p>
					<h2 id="thesis-heading">
						Most memory stacks remember the answer.
						<em>They forget the system around it.</em>
					</h2>
				</div>
				<div className={styles.fragmentGrid}>
					{fragments.map((fragment) => (
						<article key={fragment.number}>
							<span>{fragment.number}</span>
							<h3>{fragment.title}</h3>
							<p>{fragment.body}</p>
						</article>
					))}
				</div>
				<p className={styles.thesisLine}>
					The result is a chain of indexes, graphs, files, policy layers, and
					sync jobs, each holding only part of the truth.
				</p>
			</section>

			<section
				className={styles.architectureSection}
				id="architecture"
				aria-labelledby="architecture-heading"
			>
				<div className={styles.sectionLead}>
					<p className={styles.eyebrow}>The living system</p>
					<h2 id="architecture-heading">
						One living system, not a pipeline of loose parts.
					</h2>
					<p>
						Each stage adds a contract. None of them erase the source that came
						before.
					</p>
				</div>
				<div className={styles.systemRail}>
					{architectureStages.map((stage, index) => (
						<article key={stage.id}>
							<div>
								<span>{String(index + 1).padStart(2, "0")}</span>
								<strong>{stage.label.split(" / ")[1]}</strong>
							</div>
							<h3>{stage.title}</h3>
							<p>{stage.description}</p>
							<a href={stage.source.href}>{stage.source.label} ↗</a>
						</article>
					))}
				</div>
			</section>

			<section
				className={styles.proofSection}
				id="proof"
				aria-labelledby="proof-heading"
			>
				<div className={styles.sectionLead}>
					<p className={styles.eyebrow}>Executable ideas</p>
					<h2 id="proof-heading">Five ways to prove it.</h2>
					<p>
						Not animations pretending to be a product. Each scenario links to
						the repository path that exercises the behavior.
					</p>
				</div>
				<ScenarioExplorer scenarios={proofScenarios} />
			</section>

			<section
				className={styles.mongodbSection}
				aria-labelledby="mongodb-heading"
			>
				<div className={styles.mongoIntro}>
					<p className={styles.eyebrow}>Why MongoDB</p>
					<h2 id="mongodb-heading">Why MongoDB changes the architecture.</h2>
					<p>
						MongoDB is not just the vector store at the end of the diagram. It
						lets documents, transactions, search, rankings, and graph traversal
						share one operational boundary.
					</p>
					<a href="https://www.mongodb.com/docs/atlas/atlas-vector-search/hybrid-search/">
						Read the MongoDB retrieval docs ↗
					</a>
				</div>
				<div className={styles.mongoCapabilities}>
					{mongoCapabilities.map((capability) => (
						<article key={capability.name}>
							<code>{capability.syntax}</code>
							<h3>{capability.name}</h3>
							<p>{capability.body}</p>
						</article>
					))}
				</div>
			</section>

			<section
				className={styles.comparisonSection}
				id="comparison"
				aria-labelledby="comparison-heading"
			>
				<div className={styles.sectionLead}>
					<p className={styles.eyebrow}>Category comparison</p>
					<h2 id="comparison-heading">Compare architectures, not slogans.</h2>
					<p>
						These categories solve different jobs. “External” means the
						capability can be added, but is not part of the category’s core
						model.
					</p>
				</div>
				<section
					aria-labelledby="comparison-table-heading"
					className={styles.tableWrap}
					// A horizontally scrollable region must be keyboard focusable.
					// biome-ignore lint/a11y/noNoninteractiveTabindex: Enables keyboard scrolling.
					tabIndex={0}
				>
					<h3 className={styles.visuallyHidden} id="comparison-table-heading">
						Architecture capability comparison
					</h3>
					<table>
						<thead>
							<tr>
								<th scope="col">Capability</th>
								{categoryComparisons.map((category) => (
									<th
										className={
											category.id === "mdbrain" ? styles.highlightCell : ""
										}
										key={category.id}
										scope="col"
									>
										{category.label}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{comparisonRows.map((row) => (
								<tr key={row.id}>
									<th scope="row">{row.label}</th>
									{categoryComparisons.map((category) => (
										<td
											className={
												category.id === "mdbrain" ? styles.highlightCell : ""
											}
											data-value={category.capabilities[row.id]}
											key={category.id}
										>
											{category.capabilities[row.id]}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</section>
				<div className={styles.comparisonFooter}>
					<p>
						Need product-by-product context? The field guide cites only
						first-party sources and states where each alternative is stronger.
					</p>
					<Link href="/compare">Open the sourced field guide →</Link>
				</div>
			</section>

			<section
				className={styles.evidenceSection}
				aria-labelledby="evidence-heading"
			>
				<div className={styles.sectionLead}>
					<p className={styles.eyebrow}>Evidence ledger</p>
					<h2 id="evidence-heading">Inspect every claim.</h2>
					<p>
						The showcase distinguishes code-backed behavior, capabilities that
						require a configured runtime, and services deployed outside this
						repository.
					</p>
				</div>
				<div className={styles.evidenceLedger}>
					{evidence.map((item, index) => (
						<a href={item.href} key={item.claim}>
							<span>{String(index + 1).padStart(2, "0")}</span>
							<strong>{item.claim}</strong>
							<small data-status={item.status}>{item.status}</small>
							<p>{item.detail}</p>
							<b aria-hidden="true">↗</b>
						</a>
					))}
				</div>
			</section>

			<section
				className={styles.quickstartSection}
				id="quickstart"
				aria-labelledby="quickstart-heading"
			>
				<div className={styles.quickstartCopy}>
					<p className={styles.eyebrow}>Run it yourself</p>
					<h2 id="quickstart-heading">Install the entire system.</h2>
					<p>
						Clone the repository, start the transaction-capable local MongoDB
						stack, connect a compatible Memongo 2.0.1 service, and boot the API.
						No hosted MDBrain account is required.
					</p>
					<a href={`${repository}#quickstart`}>Read the full quickstart ↗</a>
				</div>
				<section aria-labelledby="terminal-heading" className={styles.terminal}>
					<h3 className={styles.visuallyHidden} id="terminal-heading">
						Terminal quickstart
					</h3>
					<div>
						<span />
						<span />
						<span />
						<small>~/mdbrain</small>
					</div>
					<pre>
						<code>{`git clone https://github.com/romiluz13/mdbrain.git
cd mdbrain && bun install

docker compose \\
  -f docker/docker-compose.minimal.yml up -d

# Configure a compatible Memongo 2.0.1 service
export MDBRAIN_WIKI_MONGODB_URI="mongodb://127.0.0.1:27017/?replicaSet=rs0"
export MEMONGO_API_URL=http://127.0.0.1:3900
export MEMONGO_API_KEY=local-memongo-secret
export MEMONGO_ALLOW_INSECURE_LOCAL=1
export MDBRAIN_API_KEY=local-dev-secret

bun --cwd apps/api dev`}</code>
					</pre>
				</section>
			</section>

			<footer className={styles.footer}>
				<div>
					<p className={styles.eyebrow}>The open blueprint</p>
					<h2>Build an AI that can remember, revise, and explain.</h2>
				</div>
				<div className={styles.footerLinks}>
					<a className={styles.primaryButton} href={repository}>
						Explore the repository ↗
					</a>
					<Link className={styles.secondaryButton} href="/compare">
						Read the field guide
					</Link>
				</div>
				<p className={styles.footerNote}>
					MDBrain is an independent open-source project. MongoDB is a trademark
					of MongoDB, Inc.
				</p>
			</footer>
		</main>
	)
}
