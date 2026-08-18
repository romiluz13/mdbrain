export type PublishablePackage = {
	dir: string
	name: string
	supportedSurface: boolean
}

export const publishablePackages = [
	{
		dir: "packages/lib",
		name: "@mdbrain/lib",
		supportedSurface: false,
	},
	{
		dir: "packages/wiki-engine",
		name: "@mdbrain/wiki-engine",
		supportedSurface: true,
	},
	{
		dir: "packages/memory-bridge",
		name: "@mdbrain/memory-bridge",
		supportedSurface: true,
	},
	{
		dir: "packages/client",
		name: "@mdbrain/client",
		supportedSurface: true,
	},
	{
		dir: "packages/tools",
		name: "@mdbrain/tools",
		supportedSurface: true,
	},
	{
		dir: "packages/mdbrain-memory",
		name: "@mdbrain/memory",
		supportedSurface: true,
	},
] as const satisfies readonly PublishablePackage[]

export const publishCohortCommand =
	"package_output=$(bun scripts/publish-package-cohort.ts paths)"

export function validatePublishablePackages(
	packages: readonly PublishablePackage[],
): void {
	const dirs = new Set<string>()
	const names = new Set<string>()
	for (const packageSpec of packages) {
		if (dirs.has(packageSpec.dir)) {
			throw new Error(`duplicate publishable package path: ${packageSpec.dir}`)
		}
		if (names.has(packageSpec.name)) {
			throw new Error(`duplicate publishable package name: ${packageSpec.name}`)
		}
		dirs.add(packageSpec.dir)
		names.add(packageSpec.name)
	}
}

export function validatePublishWorkflow(workflow: string): void {
	const cohortCommandPattern =
		/^\s*package_output=\$\(bun scripts\/publish-package-cohort\.ts paths\)\s*$/m
	if (!cohortCommandPattern.test(workflow)) {
		throw new Error(
			`publish workflow must consume the authoritative package cohort with: ${publishCohortCommand}`,
		)
	}
	const literalPackagePaths = workflow.match(/packages\/[a-z0-9-]+/g)
	if (literalPackagePaths?.length) {
		throw new Error(
			`publish workflow must not contain a second package cohort: ${literalPackagePaths.join(", ")}`,
		)
	}
	const publishCommands = workflow.match(/\bnpm publish\b/g) ?? []
	if (publishCommands.length !== 1) {
		throw new Error(
			`publish workflow must contain exactly one cohort-driven npm publish command, found ${publishCommands.length}`,
		)
	}
}

if (process.argv[1]?.endsWith("publish-package-cohort.ts")) {
	const command = process.argv[2]
	if (command !== "paths") {
		throw new Error("usage: bun scripts/publish-package-cohort.ts paths")
	}
	validatePublishablePackages(publishablePackages)
	for (const packageSpec of publishablePackages) {
		console.log(packageSpec.dir)
	}
}
