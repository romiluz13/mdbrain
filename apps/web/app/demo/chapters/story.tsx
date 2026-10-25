import { useMemo } from "react"
import { buildStory } from "../../../lib/demo-data/story.js"
import { useDemo } from "../demo-context.js"
import { StoryView } from "./story-view.js"

export function StoryChapter() {
	const { data, see } = useDemo()
	const story = useMemo(
		() =>
			buildStory({
				map: data.map,
				contradiction: data.contradiction,
				run: data.run,
			}),
		[data.map, data.contradiction, data.run],
	)
	return <StoryView story={story} onSee={see} />
}
