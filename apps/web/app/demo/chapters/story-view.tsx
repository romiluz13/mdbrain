import {
	type Judged,
	READINESS_LABEL,
	type Readiness,
	STORY_SECTION_LINE,
	type Story,
	type StoryTarget,
} from "../../../lib/demo-data/story.js"
import styles from "./story.module.css"

function Status({ readiness }: { readiness: Readiness }) {
	return (
		<span className={styles.status} data-readiness={readiness}>
			{READINESS_LABEL[readiness]}
		</span>
	)
}

/** One judged item: its status, then its filled copy when it is shown, or the
 * fixed label that says why it is not. */
function Judgement({ item }: { item: Judged }) {
	return (
		<p className={styles.judged}>
			<Status readiness={item.readiness} />
			{item.text ?? item.note}
		</p>
	)
}

function SeeIt({
	target,
	onSee,
}: {
	target: StoryTarget
	onSee: (target: StoryTarget) => void
}) {
	return (
		<button type="button" className={styles.see} onClick={() => onSee(target)}>
			See it
		</button>
	)
}

export function StoryView({
	story,
	onSee,
}: {
	story: Story
	onSee: (target: StoryTarget) => void
}) {
	return (
		<div className={styles.story} data-testid="story">
			<section className={styles.block} aria-labelledby="story-what">
				<h2 id="story-what" className={styles.heading}>
					In one sentence
				</h2>
				<p className={styles.definition}>{story.definition}</p>
				<Judgement item={story.lead} />
			</section>

			<section className={styles.block} aria-labelledby="story-how">
				<h2 id="story-how" className={styles.heading}>
					How it got here
				</h2>
				<Judgement item={story.summary.counts} />
				<Judgement item={story.summary.handoff} />
				<Judgement item={story.summary.proposal} />
			</section>

			<section className={styles.block} aria-labelledby="story-beats">
				<h2 id="story-beats" className={styles.heading}>
					The recorded run, in six beats
				</h2>
				<ol className={styles.beats}>
					{story.beats.map((beat) => (
						<li
							key={beat.n}
							className={styles.beat}
							data-testid={`story-beat-${beat.n}`}
							data-readiness={beat.readiness}
						>
							<h3 className={styles.beatTitle}>{beat.title}</h3>
							<Judgement item={beat} />
							{beat.n === 3 ? (
								<ul className={styles.citations}>
									{story.citations.map((citation) => (
										<li key={`${citation.pageTitle ?? ""}|${citation.label}`}>
											<Status readiness={citation.readiness} />
											{citation.pageTitle ? `${citation.pageTitle}: ` : ""}
											{citation.label}
										</li>
									))}
								</ul>
							) : null}
							<SeeIt target={beat.target} onSee={onSee} />
						</li>
					))}
				</ol>
			</section>

			<section className={styles.block} aria-labelledby="story-properties">
				<h2 id="story-properties" className={styles.heading}>
					What the best company brain must do
				</h2>
				<p className={styles.sectionLine}>{STORY_SECTION_LINE}</p>
				<ul className={styles.cards}>
					{story.properties.map((property) => (
						<li
							key={property.title}
							className={styles.card}
							data-readiness={property.readiness}
						>
							<h3 className={styles.beatTitle}>{property.title}</h3>
							<Judgement item={property} />
							<SeeIt target={property.target} onSee={onSee} />
						</li>
					))}
				</ul>
			</section>
		</div>
	)
}
