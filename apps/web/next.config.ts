import path from "node:path"
import type { NextConfig } from "next"

const staticExport = process.env.MDBRAIN_WEB_STATIC_EXPORT === "true"

const nextConfig: NextConfig = {
	output: staticExport ? "export" : undefined,
	outputFileTracingRoot: path.join(__dirname, "../../"),
	reactStrictMode: true,
	images: {
		unoptimized: staticExport,
	},
	transpilePackages: ["@mdbrain/client"],
	allowedDevOrigins: ["127.0.0.1"],
}

export default nextConfig
