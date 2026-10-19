import type { Metadata } from "next"
import { WorkspaceApp } from "./workspace-app.js"

export const metadata: Metadata = {
	title: "Workspace | MDBrain",
	description:
		"Create knowledge pages, capture conversation events, and inspect the stored records, provenance, and revision history that come back from a scoped MDBrain API.",
}

export default function WorkspacePage() {
	return <WorkspaceApp />
}
