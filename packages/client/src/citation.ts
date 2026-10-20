// The citation marker: one string that names a wiki claim at a revision, or a
// stored source event. Agents emit it, the API resolves it (GET /v1/cite).
//
//   [[wiki:SLUG#CLAIM_ID@rREVISION]]   a claim exactly as stored at that revision
//   [[event:EVENT_ID]]                 a source event
//
// Each variable part is encodeURIComponent output with "/" left readable, so
// the only "#", "@r", "[" and "]" in a marker are its own delimiters.

export type CitationMarker =
	| { kind: "wiki"; slug: string; claimId: string; revision: number }
	| { kind: "event"; eventId: string }

export type CitationMarkerParse =
	| { ok: true; marker: CitationMarker }
	| { ok: false; reason: string }

const MAX_MARKER_LENGTH = 2048
const PART = "[A-Za-z0-9\\-_.!~*'()/%]+"
const WIKI_MARKER = new RegExp(
	`^\\[\\[wiki:(${PART})#(${PART})@r([1-9][0-9]*)\\]\\]$`,
)
const EVENT_MARKER = new RegExp(`^\\[\\[event:(${PART})\\]\\]$`)
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects
const CONTROL = /[\u0000-\u001f\u007f]/

function encodePart(name: string, value: string): string {
	if (typeof value !== "string" || value === "" || CONTROL.test(value)) {
		throw new Error(`${name} must be non-empty text without control characters`)
	}
	try {
		return encodeURIComponent(value).replaceAll("%2F", "/")
	} catch {
		throw new Error(`${name} is not valid text`)
	}
}

export function formatCitationMarker(marker: CitationMarker): string {
	if (marker.kind === "event") {
		return withinLimit(`[[event:${encodePart("eventId", marker.eventId)}]]`)
	}
	if (!Number.isSafeInteger(marker.revision) || marker.revision < 1) {
		throw new Error("revision must be a positive safe integer")
	}
	return withinLimit(
		`[[wiki:${encodePart("slug", marker.slug)}#${encodePart("claimId", marker.claimId)}@r${marker.revision}]]`,
	)
}

// The formatter's domain is the parser's: a marker it writes always parses.
function withinLimit(marker: string): string {
	if (marker.length > MAX_MARKER_LENGTH) {
		throw new Error(
			`marker would exceed ${MAX_MARKER_LENGTH} characters once encoded`,
		)
	}
	return marker
}

function decodePart(encoded: string): string | undefined {
	try {
		const decoded = decodeURIComponent(encoded)
		return CONTROL.test(decoded) ? undefined : decoded
	} catch {
		return undefined
	}
}

const BAD_SHAPE =
	"not a citation marker: expected [[wiki:SLUG#CLAIM_ID@rREVISION]] or [[event:EVENT_ID]]"
const BAD_ENCODING = "marker has invalid percent-encoding or control characters"

export function parseCitationMarker(text: string): CitationMarkerParse {
	if (typeof text !== "string" || text.length > MAX_MARKER_LENGTH) {
		return {
			ok: false,
			reason: `marker must be text of at most ${MAX_MARKER_LENGTH} characters`,
		}
	}
	const wiki = WIKI_MARKER.exec(text)
	if (wiki) {
		const slug = decodePart(wiki[1])
		const claimId = decodePart(wiki[2])
		const revision = Number(wiki[3])
		if (slug === undefined || claimId === undefined) {
			return { ok: false, reason: BAD_ENCODING }
		}
		if (!Number.isSafeInteger(revision)) {
			return { ok: false, reason: "revision is not a safe positive integer" }
		}
		return { ok: true, marker: { kind: "wiki", slug, claimId, revision } }
	}
	const event = EVENT_MARKER.exec(text)
	if (event) {
		const eventId = decodePart(event[1])
		return eventId === undefined
			? { ok: false, reason: BAD_ENCODING }
			: { ok: true, marker: { kind: "event", eventId } }
	}
	return { ok: false, reason: BAD_SHAPE }
}
