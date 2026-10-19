"use client"

import { useState } from "react"
import { ConnectionForm } from "./connection-form.js"
import type { Connection, ConnectionDraft } from "./identity.js"
import { KnowledgeLane } from "./knowledge-lane.js"
import { MemoryLane } from "./memory-lane.js"
import styles from "./workspace.module.css"
import { ConnectionProvider } from "./workspace-context.js"

const defaultApi =
	process.env.NEXT_PUBLIC_MDBRAIN_API_URL ?? "http://127.0.0.1:3847"

type Lane = "knowledge" | "memory"

export function WorkspaceApp() {
	const [draft, setDraft] = useState<ConnectionDraft>({
		baseUrl: defaultApi,
		apiKey: "",
		agentId: "",
		scope: "",
		scopeRef: "",
	})
	const [connection, setConnection] = useState<Connection | null>(null)
	const [counter, setCounter] = useState(1)
	const [lane, setLane] = useState<Lane>("knowledge")

	return (
		<div className={styles.page}>
			<a className={styles.skip} href="#workspace-main">
				Skip to workspace
			</a>
			<header className={styles.header}>
				<div className={styles.headerInner}>
					<h1 className={styles.brand}>
						MDBrain workspace <span>Inspect what your agent knows</span>
					</h1>
					{connection ? (
						<section
							className={styles.identity}
							aria-label="Configured connection"
						>
							<span>
								Configured for <b>{connection.baseUrl}</b>
							</span>
							<span>
								agent <b>{connection.agentId}</b>
							</span>
							<span>
								scope{" "}
								<b>
									{connection.scope}/{connection.scopeRef}
								</b>
							</span>
							<button
								type="button"
								className={styles.button}
								onClick={() => setConnection(null)}
							>
								Change connection
							</button>
						</section>
					) : null}
				</div>
			</header>
			<main id="workspace-main" className={styles.wrap}>
				{connection ? (
					<ConnectionProvider key={connection.id} connection={connection}>
						<ul className={styles.laneNav} aria-label="Stores">
							<li>
								<button
									type="button"
									aria-pressed={lane === "knowledge"}
									onClick={() => setLane("knowledge")}
								>
									Knowledge pages
								</button>
							</li>
							<li>
								<button
									type="button"
									aria-pressed={lane === "memory"}
									onClick={() => setLane("memory")}
								>
									Conversation memory
								</button>
							</li>
						</ul>
						<div id="lane-knowledge" hidden={lane !== "knowledge"}>
							<KnowledgeLane />
						</div>
						<div id="lane-memory" hidden={lane !== "memory"}>
							<MemoryLane />
						</div>
					</ConnectionProvider>
				) : (
					<ConnectionForm
						draft={draft}
						onDraft={setDraft}
						nextId={counter}
						onConnect={(next) => {
							setCounter(counter + 1)
							setLane("knowledge")
							setConnection(next)
						}}
					/>
				)}
			</main>
		</div>
	)
}
