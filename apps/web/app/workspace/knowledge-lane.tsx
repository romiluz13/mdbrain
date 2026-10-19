"use client"

import { useState } from "react"
import { PageCreate } from "./page-create.js"
import { PageList } from "./page-list.js"
import { PageReader } from "./page-reader.js"
import { WikiQuery } from "./wiki-query.js"
import styles from "./workspace.module.css"
import { Empty } from "./ledger.js"

type View =
	| { kind: "none" }
	| { kind: "create" }
	| { kind: "page"; slug: string }

export function KnowledgeLane() {
	const [view, setView] = useState<View>({ kind: "none" })
	const [listVersion, setListVersion] = useState(0)
	const refreshList = () => setListVersion((version) => version + 1)

	return (
		<div>
			<div className={styles.laneIntro}>
				<h2>Knowledge pages</h2>
				<p>
					Governed wiki records stored by MDBrain's wiki. Pages saved here are
					separate from conversation memory and are not added to it.
				</p>
			</div>
			<div className={styles.columns}>
				<div className={styles.stack}>
					<PageList
						version={listVersion}
						selectedSlug={view.kind === "page" ? view.slug : undefined}
						onSelect={(slug) => setView({ kind: "page", slug })}
						onNew={() => setView({ kind: "create" })}
					/>
					<WikiQuery onSelect={(slug) => setView({ kind: "page", slug })} />
				</div>
				<div className={styles.stack}>
					{view.kind === "none" ? (
						<Empty title="No page open">
							Choose a page from the list or search results, or create a new
							one.
						</Empty>
					) : null}
					{view.kind === "create" ? (
						<PageCreate
							onCreated={(slug) => {
								refreshList()
								setView({ kind: "page", slug })
							}}
						/>
					) : null}
					{view.kind === "page" ? (
						<PageReader
							key={view.slug}
							slug={view.slug}
							onChanged={refreshList}
						/>
					) : null}
				</div>
			</div>
		</div>
	)
}
