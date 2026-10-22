// What the D15 bounds measurements share: the profiles, the page-side
// instrumentation (outstanding animation frames, WebGL contexts, listeners) and
// where the numbers are written. Adapted from the 304 prototype harness.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import type {
	Browser,
	BrowserContext,
	CDPSession,
	Page,
} from "@playwright/test"
import { installDemoProxy } from "./demo-proxy"

export type DemoProxy = Awaited<ReturnType<typeof installDemoProxy>>

export const OUT = process.env.T334_OUT ?? ""
export const GL = process.env.T334_GL === "software" ? "software" : "gpu"

/** The 304 throttle for the phone: CPU 4x, 9 Mbit/s down, 1.5 up, 150 ms RTT. */
export const MOBILE_THROTTLE =
	"mobile 390x844 DPR3, CPU 4x, network 9 Mbit/s down / 1.5 Mbit/s up / 150 ms RTT, HTTP cache disabled"

/** The proxy reads are served inside the browser, so the link is modelled: 150
 * ms per read, then the gzipped body on a 9 Mbit/s downlink shared by every read. */
export const LINK = { latencyMs: 150, bytesPerSecond: (9 * 1024 * 1024) / 8 }

export const PROFILES = {
	mobile: {
		context: {
			viewport: { width: 390, height: 844 },
			deviceScaleFactor: 3,
			isMobile: true,
			hasTouch: true,
		},
		cpu: 4,
		network: true,
	},
	desktop: {
		context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
		cpu: 1,
		network: false,
	},
	desktopThrottled: {
		context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
		cpu: 4,
		network: false,
	},
	trailer: {
		context: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
		cpu: 1,
		network: false,
	},
} as const
export type ProfileName = keyof typeof PROFILES

export const median = (values: number[]): number =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number

export function save(name: string, data: unknown): void {
	if (!OUT) {
		return
	}
	mkdirSync(OUT, { recursive: true })
	writeFileSync(
		path.join(OUT, `${name}-${GL}.json`),
		`${JSON.stringify(data, null, 2)}\n`,
	)
}

/** Counts, in the page: animation frames asked for and not yet run, WebGL
 * contexts created and still live, listeners added and not removed; and says
 * when the map first drew with its numbers in, and when the numbers stopped. */
export const INSTRUMENT = `(() => {
	if (window.__bounds) return
	window.__bounds = true
	const active = new Set()
	const rAF = window.requestAnimationFrame.bind(window)
	const cAF = window.cancelAnimationFrame.bind(window)
	window.requestAnimationFrame = (cb) => { const id = rAF((t) => { active.delete(id); cb(t) }); active.add(id); return id }
	window.cancelAnimationFrame = (id) => { active.delete(id); cAF(id) }
	window.__raf = () => active.size
	let rafCalls = 0
	const counted = window.requestAnimationFrame
	window.requestAnimationFrame = (cb) => { rafCalls++; return counted(cb) }
	window.__rafCalls = () => rafCalls
	const refs = []
	let created = 0
	const getContext = HTMLCanvasElement.prototype.getContext
	HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
		const c = getContext.call(this, type, ...rest)
		if (c && /webgl/.test(type) && !refs.some((r) => r.deref() === c)) { refs.push(new WeakRef(c)); created++ }
		return c
	}
	window.__gl = () => ({ created, live: refs.filter((r) => { const c = r.deref(); return c && !c.isContextLost() }).length })
	const cbIds = new WeakMap(); const tIds = new WeakMap(); let cn = 0, tn = 0
	// A listener counts while its target can still be reached: window, document,
	// a media query and the like for ever, an element while it is in the page.
	// React never removes the listeners it puts on an element, because the
	// element and they are collected together once it leaves the page.
	const seen = new Map()
	const key = (t, type, cb, opts) => {
		const cap = typeof opts === 'boolean' ? opts : !!(opts && opts.capture)
		let cid = cbIds.get(cb); if (!cid) { cid = ++cn; cbIds.set(cb, cid) }
		let tid = tIds.get(t); if (!tid) { tid = ++tn; tIds.set(t, tid) }
		return tid + '|' + type + '|' + cid + '|' + cap
	}
	const add = EventTarget.prototype.addEventListener
	const rem = EventTarget.prototype.removeEventListener
	EventTarget.prototype.addEventListener = function (type, cb, opts) {
		try { if (cb && !(opts && typeof opts === 'object' && opts.once)) { const k = key(this, type, cb, opts); if (!seen.has(k)) seen.set(k, { ref: new WeakRef(this), node: this instanceof Node }) } } catch {}
		return add.call(this, type, cb, opts)
	}
	EventTarget.prototype.removeEventListener = function (type, cb, opts) {
		try { if (cb) seen.delete(key(this, type, cb, opts)) } catch {}
		return rem.call(this, type, cb, opts)
	}
	window.__listeners = () => {
		let live = 0
		for (const entry of seen.values()) {
			const target = entry.ref.deref()
			if (target && (!entry.node || target.isConnected)) live++
		}
		return live
	}
	const tweens = () => { const s = window[Symbol.for('mdbrain.demo.motion')]; return s ? s.tweens() : -1 }
	window.__tweens = tweens
	let shifts = []
	try {
		const name = (n) => !n ? '?' : n.nodeType === 3 ? 'text in ' + name(n.parentElement) : (n.tagName || '?').toLowerCase() + (n.getAttribute && n.getAttribute('data-testid') ? '[' + n.getAttribute('data-testid') + ']' : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.split(' ')[0] : '')
		new PerformanceObserver((list) => { for (const e of list.getEntries()) shifts.push({ value: e.value, recentInput: e.hadRecentInput, at: Math.round(e.startTime), nodes: (e.sources || []).map((x) => name(x.node)), rects: (e.sources || []).map((x) => [Math.round(x.previousRect.y), Math.round(x.currentRect.y), Math.round(x.previousRect.height), Math.round(x.currentRect.height)]) }) }).observe({ type: 'layout-shift', buffered: true })
	} catch {}
	window.__shifts = () => shifts
	const poll = () => {
		const tile = document.querySelector('[data-stat="pages"]')
		const text = tile ? tile.textContent : null
		const drawn = performance.getEntriesByName('demo-graph-drawn').length > 0
		if (window.__readyAt === undefined && text && text !== '\\u2014' && drawn) window.__readyAt = performance.now()
		if (window.__readyAt !== undefined && window.__settledAt === undefined && tweens() === 0) window.__settledAt = performance.now()
		if (window.__settledAt === undefined) rAF(poll)
	}
	rAF(poll)
})()`

export type Rig = {
	context: BrowserContext
	page: Page
	cdp: CDPSession
	proxy: DemoProxy
}

/** A page on a profile, with the fixture proxy installed and the page-side
 * instrumentation running from the first script. */
export async function rig(
	browser: Browser,
	profile: ProfileName,
	options: { link?: typeof LINK; reducedMotion?: "reduce" } = {},
): Promise<Rig> {
	const settings = PROFILES[profile]
	const context = await browser.newContext({
		...settings.context,
		reducedMotion: options.reducedMotion ?? "no-preference",
	})
	const page = await context.newPage()
	const proxy = await installDemoProxy(page, { link: options.link })
	await page.addInitScript(INSTRUMENT)
	const cdp = await context.newCDPSession(page)
	await cdp.send("Network.enable")
	if (settings.network) {
		await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
		await cdp.send("Network.emulateNetworkConditions", {
			offline: false,
			downloadThroughput: (9 * 1024 * 1024) / 8,
			uploadThroughput: (1.5 * 1024 * 1024) / 8,
			latency: 150,
		})
	}
	if (settings.cpu > 1) {
		await cdp.send("Emulation.setCPUThrottlingRate", { rate: settings.cpu })
	}
	return { context, page, cdp, proxy }
}

export type Counts = {
	gl: { created: number; live: number }
	raf: number
	tweens: number
	listeners: number
	heapMB: number
}

export const counts = (page: Page): Promise<Counts> =>
	page.evaluate(() => {
		const w = window as unknown as {
			__gl: () => { created: number; live: number }
			__raf: () => number
			__tweens: () => number
			__listeners: () => number
		}
		const memory = (
			performance as unknown as { memory?: { usedJSHeapSize: number } }
		).memory
		return {
			gl: w.__gl(),
			raf: w.__raf(),
			tweens: w.__tweens(),
			listeners: w.__listeners(),
			heapMB: Math.round(((memory?.usedJSHeapSize ?? 0) / 1048576) * 100) / 100,
		}
	})

/** The scene's own state, from the seam the specs share. */
export const sceneNow = (page: Page) =>
	page.evaluate(() => {
		const seam = Reflect.get(window, Symbol.for("mdbrain.demo.scene")) as
			| {
					state: () => {
						frames: number
						drift: number
						nodes: number
						edges: number
						link: boolean | null
					}
			  }
			| undefined
		return seam?.state() ?? null
	})

export const FIRST_FRAME = () =>
	performance.getEntriesByName("demo-scene-first-frame").length > 0

export const viewOf = (page: Page) =>
	page.evaluate(
		() =>
			document.querySelector("[data-view]")?.getAttribute("data-view") ?? null,
	)

/** Frame cadence over `ms`: animation frames run, frames the scene drew. */
export const sample = (page: Page, ms: number) =>
	page.evaluate(async (span) => {
		const seam = Reflect.get(window, Symbol.for("mdbrain.demo.scene")) as
			| { state: () => { frames: number } }
			| undefined
		const drawn0 = seam?.state().frames ?? 0
		const times: number[] = []
		await new Promise<void>((resolve) => {
			const tick = (t: number) => {
				times.push(t)
				if (t - (times[0] as number) < span) {
					requestAnimationFrame(tick)
				} else {
					resolve()
				}
			}
			requestAnimationFrame(tick)
		})
		const gaps = times.slice(1).map((t, at) => t - (times[at] as number))
		const sorted = [...gaps].sort((a, b) => a - b)
		const seconds = ((times.at(-1) as number) - (times[0] as number)) / 1000
		const drawn1 = Reflect.get(window, Symbol.for("mdbrain.demo.scene")) as
			| { state: () => { frames: number } }
			| undefined
		return {
			seconds: Math.round(seconds * 100) / 100,
			rafFps: Math.round((gaps.length / seconds) * 10) / 10,
			p95Ms:
				Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 10) / 10,
			worstMs: Math.round((sorted.at(-1) ?? 0) * 10) / 10,
			drawnFps: drawn1
				? Math.round(((drawn1.state().frames - drawn0) / seconds) * 10) / 10
				: null,
		}
	}, ms)

/** Frames the scene draws while the camera is under way: from the first frame
 * its pose differs from the last until it has held still for ten frames. The
 * camera stays framed on the pair after it arrives, so "held" is not "moving". */
export const flightSample = (page: Page) =>
	page.evaluate(async () => {
		type Scene = {
			frames: number
			pose: { gx: number; gy: number; gz: number; yaw: number; d: number }
		}
		const state = () =>
			(
				Reflect.get(window, Symbol.for("mdbrain.demo.scene")) as {
					state: () => Scene
				}
			).state()
		const poseKey = (scene: Scene) =>
			Object.values(scene.pose)
				.map((v) => v.toFixed(5))
				.join(",")
		const times: number[] = []
		let last = poseKey(state())
		let drawn0 = 0
		let started = false
		let still = 0
		let drawn1 = 0
		await new Promise<void>((resolve) => {
			const tick = (t: number) => {
				const now = state()
				const key = poseKey(now)
				if (key !== last) {
					if (!started) {
						started = true
						drawn0 = now.frames
					}
					still = 0
					last = key
				} else if (started) {
					still += 1
				}
				if (started) {
					times.push(t)
					drawn1 = now.frames
					if (still >= 10) {
						resolve()
						return
					}
				}
				if (times.length > 400) {
					resolve()
					return
				}
				requestAnimationFrame(tick)
			}
			requestAnimationFrame(tick)
			setTimeout(resolve, 8000)
		})
		const moving = times.slice(0, Math.max(1, times.length - 10))
		const seconds = ((moving.at(-1) ?? 0) - (moving[0] ?? 0)) / 1000
		const drawn = drawn1 - drawn0
		const gaps = moving.slice(1).map((t, at) => t - (moving[at] as number))
		return {
			seconds: Math.round(seconds * 100) / 100,
			drawn,
			drawnFps: seconds > 0 ? Math.round((drawn / seconds) * 10) / 10 : null,
			worstGapMs: Math.round(Math.max(0, ...gaps) * 10) / 10,
		}
	})

export const errorsOf = (page: Page): string[] => {
	const found: string[] = []
	page.on("pageerror", (error) => found.push(`pageerror: ${error.message}`))
	page.on("console", (message) => {
		if (message.type() === "error") {
			found.push(message.text())
		}
	})
	return found
}

export const CHAPTERS_TOTAL = 9

/** Launch options for the bounds specs: T334_CHROME is a Chrome for Testing
 * whose GL goes to the GPU; without it the browser is Playwright's, drawing
 * with SwiftShader (the software bracket). */
export const BOUNDS_LAUNCH = {
	executablePath: process.env.T334_CHROME || undefined,
	args: [
		"--enable-precise-memory-info",
		...(process.env.T334_CHROME
			? ["--use-angle=metal", "--ignore-gpu-blocklist"]
			: []),
	],
}
