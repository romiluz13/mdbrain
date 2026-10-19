"use client"

import { useState } from "react"
import { EventCapture } from "./event-capture.js"
import { RecallPanel } from "./recall-panel.js"
import { RetrievalPanel } from "./retrieval-panel.js"
import styles from "./workspace.module.css"

export function MemoryLane() {
	const [recall, setRecall] = useState<{ sessionId: string; nonce: number }>({
		sessionId: "",
		nonce: 0,
	})

	return (
		<div>
			<div className={styles.laneIntro}>
				<h2>Conversation memory</h2>
				<p>
					Events and retrieval served by Memongo. This is a separate store from
					knowledge pages: saving a page does not add anything here.
				</p>
			</div>
			<div className={styles.columns}>
				<div className={styles.stack}>
					<EventCapture
						onRecall={(sessionId) =>
							setRecall((current) => ({ sessionId, nonce: current.nonce + 1 }))
						}
					/>
				</div>
				<div className={styles.stack}>
					<RecallPanel request={recall} />
					<RetrievalPanel />
				</div>
			</div>
		</div>
	)
}
