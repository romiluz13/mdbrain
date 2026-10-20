import type { Metadata } from "next"
import "@fontsource-variable/archivo/wdth.css"
import "@fontsource-variable/source-serif-4/index.css"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"
import { DemoApp } from "./demo-app.js"

const description =
	"Nine screens on a synthetic company's stored brain: the map, a question, a caught contradiction, and the reads behind every number."

export const metadata: Metadata = {
	title: "Live demo | MDBrain",
	description,
	openGraph: {
		title: "Live demo | MDBrain",
		description,
		url: "/demo",
		siteName: "MDBrain",
		images: ["/opengraph-image"],
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "Live demo | MDBrain",
		description,
		images: ["/opengraph-image"],
	},
}

export default function DemoPage() {
	return <DemoApp />
}
