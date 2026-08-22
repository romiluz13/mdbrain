import type { Metadata } from "next"
import type { ReactNode } from "react"
import "./globals.css"

const title = "MDBrain | The living context system"
const description =
	"An open-source MongoDB blueprint for governed company knowledge and long-term agent memory."
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mdbrain.dev"
const socialImage = "/opengraph-image"

export const metadata: Metadata = {
	metadataBase: new URL(siteUrl),
	title,
	description,
	openGraph: {
		title,
		description,
		url: siteUrl,
		siteName: title,
		images: [
			{
				url: socialImage,
				width: 1200,
				height: 630,
				alt: "MDBrain maps sources, governed knowledge, long-term memory, MongoDB retrieval, and evidence into one living context system.",
			},
		],
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title,
		description,
		images: [socialImage],
	},
}

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	)
}
