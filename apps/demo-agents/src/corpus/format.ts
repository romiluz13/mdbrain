const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
]

export function longDate(isoDay: string): string {
	const [y, m, d] = isoDay.split("-").map(Number)
	return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`
}

export function usd(amount: number): string {
	return `$${amount.toLocaleString("en-US")}`
}

export function trucks(count: number): string {
	return `${count.toLocaleString("en-US")} trucks`
}

export function at(day: string, time: string): string {
	return `${day}T${time}:00.000Z`
}

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
}
