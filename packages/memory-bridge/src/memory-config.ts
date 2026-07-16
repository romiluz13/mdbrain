import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { MemoryConfig, MdbrainConfig } from "@mdbrain/lib"

export const MDBRAIN_CONFIG_FILENAME = path.join(".mdbrain", "mdbrain.json")

export function resolveMdbrainStandaloneWorkspaceDir(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const explicit = env.MDBRAIN_WORKSPACE_DIR?.trim()
	if (explicit) {
		return path.resolve(explicit)
	}
	return path.join(os.homedir(), ".mdbrain", "workspace")
}

export function resolveMdbrainConfigFilePath(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const fromEnv = env.MDBRAIN_CONFIG_PATH?.trim()
	if (fromEnv) {
		return path.resolve(fromEnv)
	}
	return path.join(os.homedir(), MDBRAIN_CONFIG_FILENAME)
}

function readMdbrainJsonFile(
	filePath: string,
): { memory?: MemoryConfig; agents?: MdbrainConfig["agents"] } | undefined {
	try {
		if (!fs.existsSync(filePath)) {
			return undefined
		}
		const raw = fs.readFileSync(filePath, "utf-8")
		const parsed = JSON.parse(raw) as unknown
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return undefined
		}
		return parsed as { memory?: MemoryConfig; agents?: MdbrainConfig["agents"] }
	} catch {
		return undefined
	}
}

export function buildMdbrainConfig(
	env: NodeJS.ProcessEnv = process.env,
): MdbrainConfig {
	const filePath = resolveMdbrainConfigFilePath(env)
	const fromFile = readMdbrainJsonFile(filePath)

	const forceUri = env.MDBRAIN_FORCE_MONGODB_URI?.trim()
	const uriFromFile = fromFile?.memory?.mongodb?.uri?.trim()
	const uri = forceUri || uriFromFile || env.MDBRAIN_MONGODB_URI?.trim()
	const collectionPrefixFromEnv = env.MDBRAIN_MONGODB_COLLECTION_PREFIX?.trim()

	const mergedMongo: MemoryConfig["mongodb"] = {
		...fromFile?.memory?.mongodb,
		...(uri ? { uri } : {}),
		...(collectionPrefixFromEnv
			? { collectionPrefix: collectionPrefixFromEnv }
			: {}),
	}

	const memory: MemoryConfig = {
		backend: "mongodb",
		citations: fromFile?.memory?.citations ?? "auto",
		sources: fromFile?.memory?.sources,
		mongodb: mergedMongo,
	}

	const workspace = resolveMdbrainStandaloneWorkspaceDir(env)

	return {
		memory,
		agents: {
			...fromFile?.agents,
			defaults: {
				...fromFile?.agents?.defaults,
				workspace,
			},
		},
	}
}

export function resolveBridgeConfig(): MdbrainConfig {
	return buildMdbrainConfig()
}
