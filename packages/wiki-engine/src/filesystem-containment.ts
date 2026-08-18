import fs from "node:fs"
import path from "node:path"

export interface ContainedFile {
	path: string
	content: string
}

function resolveRelativeFile(root: string, relativeFile: string): string {
	if (/^[A-Za-z]:/.test(relativeFile)) {
		throw new Error(`export path "${relativeFile}" must not be drive-qualified`)
	}
	if (
		path.posix.isAbsolute(relativeFile) ||
		path.win32.isAbsolute(relativeFile)
	) {
		throw new Error(`export path "${relativeFile}" must not be absolute`)
	}
	if (relativeFile.includes("\\")) {
		throw new Error(
			`export path "${relativeFile}" contains an unsafe platform separator`,
		)
	}
	const segments = relativeFile.split("/")
	if (segments.includes("..")) {
		throw new Error(`export path "${relativeFile}" contains unsafe traversal`)
	}
	return path.join(root, ...segments)
}

function isWithinRoot(candidate: string, root: string): boolean {
	const relative = path.relative(root, candidate)
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	)
}

function nearestExistingPath(candidate: string): string {
	let current = candidate
	while (!fs.existsSync(current)) {
		const parent = path.dirname(current)
		if (parent === current) break
		current = parent
	}
	return current
}

function assertExistingPathContained(
	candidate: string,
	realRoot: string,
): void {
	const existingPath = nearestExistingPath(candidate)
	const realExistingPath = fs.realpathSync(existingPath)
	if (!isWithinRoot(realExistingPath, realRoot)) {
		throw new Error(
			`export path "${candidate}" resolves outside the configured root`,
		)
	}
}

function assertTargetIsNotSymlink(candidate: string): void {
	const stat = fs.lstatSync(candidate, { throwIfNoEntry: false })
	if (stat?.isSymbolicLink()) {
		throw new Error(`export path "${candidate}" must not be a symlink`)
	}
}

/**
 * Writes a complete filesystem export beneath one root. Every relative path is
 * validated first, and every final target is proven contained before any file
 * content is written.
 */
export function writeContainedFiles(
	root: string,
	files: readonly ContainedFile[],
	approvedRoots?: readonly string[],
): void {
	const targets = files.map((file) => ({
		...file,
		target: resolveRelativeFile(root, file.path),
	}))

	const approvedRealRoots = approvedRoots?.map((approvedRoot) =>
		fs.realpathSync(approvedRoot),
	)
	if (approvedRealRoots) {
		const existingRoot = fs.realpathSync(nearestExistingPath(root))
		if (
			!approvedRealRoots.some((approvedRoot) =>
				isWithinRoot(existingRoot, approvedRoot),
			)
		) {
			throw new Error(
				`export root "${root}" resolves outside the configured roots`,
			)
		}
	}
	fs.mkdirSync(root, { recursive: true })
	const realRoot = fs.realpathSync(root)
	if (
		approvedRealRoots &&
		!approvedRealRoots.some((approvedRoot) =>
			isWithinRoot(realRoot, approvedRoot),
		)
	) {
		throw new Error(
			`export root "${root}" resolves outside the configured roots`,
		)
	}
	for (const file of targets) {
		assertExistingPathContained(path.dirname(file.target), realRoot)
	}
	for (const file of targets) {
		fs.mkdirSync(path.dirname(file.target), { recursive: true })
		assertExistingPathContained(path.dirname(file.target), realRoot)
	}
	for (const file of targets) {
		assertTargetIsNotSymlink(file.target)
		assertExistingPathContained(file.target, realRoot)
	}
	for (const file of targets) {
		assertTargetIsNotSymlink(file.target)
		assertExistingPathContained(file.target, realRoot)
		fs.writeFileSync(file.target, file.content, "utf-8")
		const realTarget = fs.realpathSync(file.target)
		if (!isWithinRoot(realTarget, realRoot)) {
			throw new Error(
				`export path "${file.target}" resolves outside the configured root`,
			)
		}
	}
}
