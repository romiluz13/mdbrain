import { describe, expect, it } from "vitest"
import {
	publishablePackages,
	validatePublishablePackages,
	validatePublishWorkflow,
} from "./publish-package-cohort.js"

describe("publish package cohort", () => {
	it("contains the supported package cohort exactly once", () => {
		expect(publishablePackages.map(({ dir, name }) => ({ dir, name }))).toEqual(
			[
				{ dir: "packages/lib", name: "@mdbrain/lib" },
				{ dir: "packages/wiki-engine", name: "@mdbrain/wiki-engine" },
				{ dir: "packages/memory-bridge", name: "@mdbrain/memory-bridge" },
				{ dir: "packages/client", name: "@mdbrain/client" },
				{ dir: "packages/tools", name: "@mdbrain/tools" },
				{ dir: "packages/mdbrain-memory", name: "@mdbrain/memory" },
			],
		)
		expect(() => validatePublishablePackages(publishablePackages)).not.toThrow()
	})

	it("rejects duplicate package paths and names", () => {
		expect(() =>
			validatePublishablePackages([
				...publishablePackages,
				{
					dir: publishablePackages[0].dir,
					name: "@mdbrain/duplicate-path",
					supportedSurface: true,
				},
			]),
		).toThrow("duplicate publishable package path")
		expect(() =>
			validatePublishablePackages([
				...publishablePackages,
				{
					dir: "packages/duplicate-name",
					name: publishablePackages[0].name,
					supportedSurface: true,
				},
			]),
		).toThrow("duplicate publishable package name")
	})

	it("rejects workflow drift from the authoritative cohort", () => {
		const validWorkflow = `
			package_output=$(bun scripts/publish-package-cohort.ts paths)
			npm publish --access public
		`
		expect(() => validatePublishWorkflow(validWorkflow)).not.toThrow()
		expect(() =>
			validatePublishWorkflow(`
				for pkg in packages/lib packages/memory-engine; do
					npm publish --access public
				done
			`),
		).toThrow("must consume the authoritative package cohort")
		expect(() =>
			validatePublishWorkflow(`
				package_output=$(bun scripts/publish-package-cohort.ts paths)
				echo packages/lib
				npm publish --access public
			`),
		).toThrow("must not contain a second package cohort")
		expect(() =>
			validatePublishWorkflow(`
				package_output=$(bun scripts/publish-package-cohort.ts paths)
				npm publish --access public
				npm publish --access public
			`),
		).toThrow("exactly one cohort-driven npm publish command")
	})
})
