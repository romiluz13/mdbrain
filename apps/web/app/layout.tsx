import type { Metadata } from "next"
import type { ReactNode } from "react"
import "./globals.css"

const title = "Mdbrain"
const description = "MongoDB-native long-term memory for production AI agents"
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mdbrain.dev"
const socialImage = "/mdbrain-social-preview.png"

export const metadata: Metadata = {
	metadataBase: new URL(siteUrl),
	title: "Mdbrain",
	description,
	openGraph: {
		title,
		description,
		url: siteUrl,
		siteName: title,
		images: [
			{
				url: socialImage,
				width: 1280,
				height: 640,
				alt: "Mdbrain - memory for AI agents should be asked, not reloaded.",
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
