"use client"

import { Fragment } from "react"
import type {
	Block,
	Inline,
	Span,
	TableCell,
} from "../../../lib/demo-data/markdown.js"
import styles from "../markdown.module.css"

type Mark = Span | null

/** A run of source text, with the part of it that falls in the mark wrapped in
 * <mark>. Text is a React child, so it is escaped: nothing in a source becomes
 * markup. */
function Run({
	text,
	start,
	mark,
}: {
	text: string
	start: number
	mark: Mark
}) {
	if (mark === null || mark.end <= start || mark.start >= start + text.length) {
		return <>{text}</>
	}
	const from = Math.max(mark.start, start) - start
	const to = Math.min(mark.end, start + text.length) - start
	return (
		<>
			{text.slice(0, from)}
			<mark>{text.slice(from, to)}</mark>
			{text.slice(to)}
		</>
	)
}

function Inlines({ nodes, mark }: { nodes: Inline[]; mark: Mark }) {
	return nodes.map((node) => {
		if (node.kind === "text") {
			return (
				<Run key={node.start} text={node.text} start={node.start} mark={mark} />
			)
		}
		if (node.kind === "code") {
			return (
				<code key={node.start}>
					<Run text={node.text} start={node.start} mark={mark} />
				</code>
			)
		}
		const Tag = node.kind === "strong" ? "strong" : "em"
		return (
			<Tag key={node.start}>
				<Inlines nodes={node.children} mark={mark} />
			</Tag>
		)
	})
}

function Cell({ cell, mark }: { cell: TableCell; mark: Mark }) {
	return <Inlines nodes={cell.inline} mark={mark} />
}

function BlockView({ block, mark }: { block: Block; mark: Mark }) {
	switch (block.kind) {
		case "heading":
			// A paragraph, not a heading element: a source's headings are its own
			// and must not rearrange the page's outline.
			return (
				<p className={styles.heading} data-level={block.level}>
					<Inlines nodes={block.inline} mark={mark} />
				</p>
			)
		case "paragraph":
			return (
				<p>
					{block.lines.map((line, position) => (
						<Fragment key={line.start}>
							{position > 0 ? <br /> : null}
							<Inlines nodes={line.inline} mark={mark} />
						</Fragment>
					))}
				</p>
			)
		case "list": {
			const Tag = block.ordered ? "ol" : "ul"
			return (
				<Tag>
					{block.items.map((item) => (
						<li
							key={item.start}
							className={styles.item}
							style={{ "--depth": item.depth } as React.CSSProperties}
						>
							<span
								className={block.ordered ? styles.number : styles.bullet}
								aria-hidden={block.ordered ? undefined : "true"}
							>
								{block.ordered ? item.marker : "•"}
							</span>
							<Inlines nodes={item.inline} mark={mark} />
						</li>
					))}
				</Tag>
			)
		}
		case "table":
			return (
				<table className={styles.table}>
					<thead>
						<tr>
							{block.header.map((cell) => (
								<th key={cell.start} scope="col">
									<Cell cell={cell} mark={mark} />
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{block.rows.map((row) => (
							<tr key={row.start}>
								{row.cells.map((cell) => (
									<td key={cell.start}>
										<Cell cell={cell} mark={mark} />
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			)
		case "code":
			return (
				<pre>
					<code>{block.text}</code>
				</pre>
			)
		case "rule":
			return <hr />
	}
}

/** Blocks read from a stored source, drawn as the page's own elements, with
 * the claim's phrase marked in place. */
export function MarkdownView({
	blocks,
	mark,
}: {
	blocks: Block[]
	mark: Mark
}) {
	return (
		<div className={styles.doc}>
			{blocks.map((block) => (
				<BlockView key={block.start} block={block} mark={mark} />
			))}
		</div>
	)
}
