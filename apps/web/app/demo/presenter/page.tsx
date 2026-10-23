import type { Metadata } from "next"
import "@fontsource-variable/archivo/wdth.css"
import "@fontsource-variable/source-serif-4/index.css"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"
import { SignIn } from "./sign-in.js"

export const metadata: Metadata = {
	title: "Presenter sign-in | MDBrain",
	robots: { index: false, follow: false },
}

export default function PresenterPage() {
	return <SignIn />
}
