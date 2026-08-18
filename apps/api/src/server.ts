import { serve } from "@hono/node-server"
import { mdbrainBridgeShutdown } from "@mdbrain/memory-bridge"
import { createApp, registerGracefulShutdown } from "./app.js"
import { startMemoryDeliveryReconciler } from "./memory-delivery-runtime.js"
import { closeWikiStore } from "./wiki-store-runtime.js"

const app = createApp()

const port = Number(process.env.MDBRAIN_API_PORT ?? "3847")
const host = process.env.MDBRAIN_API_HOST ?? "127.0.0.1"

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
	console.error(`mdbrain-api listening on http://${info.address}:${info.port}`)
})
const deliveryReconciler = startMemoryDeliveryReconciler({
	intervalMs: Number(process.env.MDBRAIN_DELIVERY_RECONCILE_MS ?? "5000"),
	onError: (error) => {
		const code =
			error && typeof error === "object" && "code" in error
				? String(error.code)
				: "UNKNOWN"
		console.error(`memory delivery reconciliation failed (${code})`)
	},
})

// Graceful shutdown: SIGTERM / SIGINT drain the server, flush the bridge, then
// exit. Timeout is set short enough for container runtimes but long enough to
// let Mongo in-flight writes finish.
registerGracefulShutdown({
	signals: ["SIGTERM", "SIGINT"],
	process,
	closeServer: () =>
		new Promise<void>((resolve) => {
			try {
				server.close(() => resolve())
			} catch {
				resolve()
			}
		}),
	closeBridge: async () => {
		await deliveryReconciler.stop()
		await Promise.all([mdbrainBridgeShutdown(), closeWikiStore()])
	},
	exit: (code) => process.exit(code),
	timeoutMs: 15_000,
})
