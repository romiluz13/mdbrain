// Topic catalogs for the generic (non-storyline) records. Each entry gives
// the renderer a situation and the exact phrase the record must contain.

export type Topic = { phrase: string; detail: string; product: string }

export const TICKET_TOPICS: Topic[] = [
	{
		phrase: "geofence arrivals",
		detail: "geofence arrivals fire early at the customer's cross-dock",
		product: "track",
	},
	{
		phrase: "ELD feed",
		detail: "the ELD feed drops positions for part of the fleet overnight",
		product: "track",
	},
	{
		phrase: "double-booked dock appointments",
		detail: "double-booked dock appointments after a daylight-saving change",
		product: "dock",
	},
	{
		phrase: "rate-limit errors",
		detail: "the carrier API returns rate-limit errors during the morning wave",
		product: "track",
	},
	{
		phrase: "proof-of-delivery photos",
		detail: "proof-of-delivery photos are missing from shipment timelines",
		product: "track",
	},
	{
		phrase: "SSO login loop",
		detail: "dispatchers hit an SSO login loop on shared terminals",
		product: "track",
	},
	{
		phrase: "stale map tiles",
		detail: "the live tracking view shows stale map tiles in one region",
		product: "track",
	},
	{
		phrase: "temperature alerts",
		detail: "temperature alerts reach the wrong on-call planner",
		product: "track",
	},
	{
		phrase: "CSV export",
		detail: "the CSV export of shipment history times out for a full month",
		product: "track",
	},
	{
		phrase: "duplicate shipments",
		detail: "the TMS integration creates duplicate shipments after retries",
		product: "track",
	},
	{
		phrase: "yard check-in kiosk",
		detail:
			"the yard check-in kiosk freezes when drivers scan paper bills of lading",
		product: "dock",
	},
	{
		phrase: "carrier self-booking",
		detail:
			"carriers can self-book slots outside the warehouse's receiving hours",
		product: "dock",
	},
	{
		phrase: "ETA after reroute",
		detail: "Predict ETA takes twenty minutes to refresh after a reroute",
		product: "predict",
	},
	{
		phrase: "border crossing delay",
		detail:
			"predicted arrivals ignore border crossing delay on international lanes",
		product: "predict",
	},
	{
		phrase: "webhook retries",
		detail: "webhook retries flood the customer's endpoint after an outage",
		product: "track",
	},
	{
		phrase: "user provisioning",
		detail: "user provisioning from the customer's directory skips new depots",
		product: "track",
	},
]

export const RESOLUTIONS = [
	"resolved with a configuration change",
	"workaround in place while engineering investigates",
	"waiting on logs from the customer",
	"closed after the customer confirmed the fix",
	"escalated to engineering",
]

export const CALL_TYPES = [
	{
		title: "Quarterly business review",
		fact: (n: number) => `on-time arrival rate of ${86 + (n % 12)}%`,
	},
	{
		title: "Onboarding check-in",
		fact: (n: number) => `${2 + (n % 6)} new depots`,
	},
	{
		title: "Expansion discovery call",
		fact: (n: number) => `${(n % 9) * 50 + 150} additional trucks`,
	},
	{
		title: "Executive sponsor sync",
		fact: (n: number) => `${3 + (n % 4)}-year roadmap`,
	},
]

export const ACCOUNT_HEALTH = [
	"healthy, steady usage",
	"healthy and expanding",
	"on watch: usage dipped after a reorg",
	"healthy, champion is very engaged",
	"on watch: open support issues",
]

export const INTERNAL_DOCS: {
	title: string
	facts: string[]
	brief: string
	product?: string
}[] = [
	{
		title: "Support escalation runbook",
		facts: ["Severity 1", "within 30 minutes"],
		brief:
			"How support grades severity and who is paged. Severity 1 gets a response within 30 minutes and an engineering owner the same day.",
	},
	{
		title: "Onboarding playbook for fleets over 1,000 trucks",
		facts: ["1,000 trucks", "six-week rollout"],
		brief:
			"Phased six-week rollout for large fleets: ELD connection, pilot depot, dispatcher training, then full fleet.",
	},
	{
		title: "How Predict ETA works",
		facts: ["gradient-boosted", "dwell time"],
		brief:
			"Explainer for account teams: a gradient-boosted model that combines live position, traffic, historical dwell time and driver hours.",
		product: "predict",
	},
	{
		title: "Dock Scheduler admin guide",
		facts: ["receiving hours", "slot length"],
		brief:
			"How warehouse admins set receiving hours, slot length per door and carrier booking rules.",
		product: "dock",
	},
	{
		title: "Incident review: carrier API outage on July 22",
		facts: ["July 22", "47 minutes"],
		brief:
			"Blameless review of a 47-minute carrier API outage on July 22 caused by an expired certificate; action items on certificate monitoring.",
	},
	{
		title: "Security questionnaire standard answers",
		facts: ["SOC 2 Type II", "EU data residency"],
		brief:
			"Approved answers for security reviews: SOC 2 Type II report, EU data residency option, SSO and SCIM.",
	},
	{
		title: "Customer health score definition",
		facts: ["weekly active dispatchers", "open Severity 1"],
		brief:
			"How the health score combines weekly active dispatchers, ETA usage, open Severity 1 tickets and executive engagement.",
	},
	{
		title: "On-call handbook",
		facts: ["follow-the-sun", "pager rotation"],
		brief:
			"Follow-the-sun on-call between the Oslo and Toronto teams; how to hand over and when to wake the incident commander.",
	},
	{
		title: "ELD integration guide",
		facts: ["30-second position", "backfill"],
		brief:
			"Requirements for ELD and telematics partners: 30-second position updates, backfill after gaps, idempotent event ids.",
		product: "track",
	},
	{
		title: "Data retention policy",
		facts: ["13 months", "deletion request"],
		brief:
			"Position history is kept for 13 months; customers can file a deletion request at any time.",
	},
	{
		title: "Release notes: Northstar Track 9.3",
		facts: ["Track 9.3", "shareable tracking links"],
		brief:
			"Track 9.3 adds shareable tracking links for consignees and faster map loading.",
		product: "track",
	},
	{
		title: "Release notes: Dock Scheduler 4.1",
		facts: ["Dock Scheduler 4.1", "carrier no-show"],
		brief:
			"Dock Scheduler 4.1 flags carrier no-show patterns and adds a waitlist for cancelled slots.",
		product: "dock",
	},
	{
		title: "Renewal playbook",
		facts: ["120 days", "mutual action plan"],
		brief:
			"Account teams start renewals 120 days out with a mutual action plan, a health review and a pricing check with deal desk.",
	},
	{
		title: "Churn review: Q2 2026",
		facts: ["two logos", "implementation stalled"],
		brief:
			"Q2 lost two logos; both had implementation stalled past 90 days. Lessons for onboarding.",
	},
	{
		title: "SLA definitions",
		facts: ["99.9% monthly uptime", "service credits"],
		brief:
			"Standard SLA: 99.9% monthly uptime for Track and Dock Scheduler, service credits above that threshold.",
	},
	{
		title: "Implementation checklist",
		facts: ["pilot depot", "go-live sign-off"],
		brief:
			"Checklist from kickoff to go-live sign-off, including pilot depot selection and dispatcher training.",
	},
	{
		title: "Quarterly planning notes: Q3 2026",
		facts: ["multi-stop accuracy", "Dock Scheduler self-serve"],
		brief:
			"Q3 bets: Predict ETA multi-stop accuracy, Dock Scheduler self-serve onboarding, EMEA expansion.",
	},
	{
		title: "Partner program overview",
		facts: ["referral partners", "implementation partners"],
		brief:
			"How referral partners and implementation partners are qualified and paid.",
	},
]

export const JIRA_TOPICS: Record<string, string[]> = {
	TRK: [
		"Map tile cache invalidation on region switch",
		"Backfill positions after ELD gaps",
		"Shareable tracking link expiry",
		"Reduce live view payload size",
		"Geofence radius per stop type",
		"Rate limiter per carrier integration",
		"Proof-of-delivery photo pipeline retries",
		"SCIM group sync for depots",
		"Shipment timeline virtualization",
		"Webhook backoff with jitter",
		"CSV export as background job",
		"Duplicate shipment detection on TMS retries",
	],
	DOCK: [
		"Waitlist for cancelled slots",
		"Timezone handling for receiving hours",
		"Kiosk barcode scanner fallback",
		"Carrier booking rules per door",
		"No-show pattern report",
		"Slot length templates",
	],
	PRED: [
		"Traffic feed latency alarm",
		"Border crossing features for international lanes",
		"Refresh ETA within two minutes of reroute",
		"Driver hours of service in predictions",
		"Accuracy dashboard by route type",
		"Shadow evaluation for model releases",
	],
	ENG: [
		"Upgrade database driver",
		"Certificate expiry monitoring",
		"Rotate service credentials",
		"Cut CI time below ten minutes",
		"Retire legacy reporting service",
		"Load test for morning wave",
		"Feature flag cleanup",
		"Structured logging in ingestion workers",
	],
}

export const SLACK_CHANNELS: {
	channel: string
	team: string
	topics: string[]
}[] = [
	{
		channel: "#eng-track",
		team: "Engineering",
		topics: [
			"deploy freeze for the morning wave",
			"map tile cache rollout",
			"ELD backfill design review",
			"flaky integration tests",
		],
	},
	{
		channel: "#eng-predict",
		team: "Engineering",
		topics: [
			"traffic feed latency",
			"shadow evaluation results",
			"driver hours feature",
			"retrain schedule",
		],
	},
	{
		channel: "#support",
		team: "Support",
		topics: [
			"handover from the Toronto shift",
			"macro for SSO login issues",
			"ticket backlog this week",
			"new ELD provider questions",
		],
	},
	{
		channel: "#sales",
		team: "Sales",
		topics: [
			"pipeline review prep",
			"security questionnaire turnaround",
			"EMEA pipeline",
			"competitive deal lost on price",
		],
	},
	{
		channel: "#cs-team",
		team: "Customer Success",
		topics: [
			"health score changes",
			"QBR deck template",
			"renewals due next quarter",
			"onboarding capacity",
		],
	},
	{
		channel: "#product",
		team: "Product",
		topics: [
			"Dock Scheduler self-serve research",
			"Q4 roadmap draft",
			"customer advisory board agenda",
			"beta feedback on shareable links",
		],
	},
	{
		channel: "#incidents",
		team: "Engineering",
		topics: [
			"carrier API outage",
			"elevated webhook latency",
			"map tiles degraded",
			"ingestion lag in EU",
		],
	},
]

export const INTERNAL_CALLS = [
	"Pipeline review",
	"Support weekly",
	"Product roadmap review",
	"Customer success staff meeting",
	"Engineering all-hands",
]

export const TEAMS: { team: string; size: number; titles: string[] }[] = [
	{
		team: "Engineering",
		size: 92,
		titles: [
			"Software Engineer",
			"Senior Software Engineer",
			"Staff Engineer",
			"Engineering Manager",
			"Site Reliability Engineer",
			"Data Engineer",
			"ML Engineer",
			"QA Engineer",
		],
	},
	{
		team: "Support",
		size: 26,
		titles: [
			"Support Engineer",
			"Senior Support Engineer",
			"Support Specialist",
		],
	},
	{
		team: "Sales",
		size: 20,
		titles: [
			"Sales Development Representative",
			"Solutions Engineer",
			"Sales Manager",
		],
	},
	{
		team: "Customer Success",
		size: 14,
		titles: [
			"Implementation Manager",
			"Customer Success Specialist",
			"Solutions Architect",
		],
	},
	{
		team: "Product",
		size: 12,
		titles: ["Product Manager", "Product Designer", "UX Researcher"],
	},
	{
		team: "Marketing",
		size: 15,
		titles: [
			"Product Marketing Manager",
			"Content Marketer",
			"Field Marketing Manager",
			"Marketing Operations",
		],
	},
	{
		team: "Finance",
		size: 8,
		titles: ["Financial Analyst", "Deal Desk Analyst", "Controller"],
	},
	{ team: "People", size: 7, titles: ["People Partner", "Recruiter"] },
	{
		team: "Operations",
		size: 11,
		titles: [
			"Business Operations Analyst",
			"IT Administrator",
			"Security Engineer",
		],
	},
]

export const CONTACT_TITLES = [
	"VP Operations",
	"Head of Dispatch",
	"Fleet Manager",
	"Procurement Manager",
	"IT Director",
	"Transport Planner",
	"Director of Logistics",
	"Warehouse Operations Manager",
]
