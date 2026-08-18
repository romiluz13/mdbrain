import {
	MemongoHttpClient,
	type MemongoHttpClientOptions,
} from "./memongo-http-client.js"
import {
	MEMONGO_CONTROL_READINESS_LANES,
	type MemongoControlReadinessLane,
	MemongoMemoryGateway,
	type MemongoReadinessReport,
} from "./memongo-memory-gateway.js"

export const MEMONGO_CONTRACT_VERSION = "2.0.1"
export const MEMONGO_CONTRACT_SHA256 =
	"01680e7ba03674ae06c899856d7521e95e66d5d1be465f172080907dc29cb8bc"

export type MemongoRuntimeConfig = Omit<
	MemongoHttpClientOptions,
	"fetchImpl" | "timeoutMs"
> & {
	timeoutMs: number
	readinessControlLanes: MemongoControlReadinessLane[]
}

function required(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name]?.trim()
	if (!value) throw new Error(`${name} is required`)
	return value
}

function optionalNumber(
	env: NodeJS.ProcessEnv,
	name: string,
	defaultValue: number,
	minimum: number,
): number {
	const raw = env[name]?.trim()
	if (!raw) return defaultValue
	const value = Number(raw)
	if (!Number.isFinite(value) || value < minimum) {
		throw new Error(`${name} must be a finite number >= ${minimum}`)
	}
	return value
}

function readinessControlLanes(
	env: NodeJS.ProcessEnv,
	controlApiKey: string | undefined,
): MemongoControlReadinessLane[] {
	const raw = env.MEMONGO_READINESS_CONTROL_LANES?.trim()
	if (!raw) return []
	const lanes = raw.split(",").map((lane) => lane.trim())
	const allowed = new Set<string>(MEMONGO_CONTROL_READINESS_LANES)
	if (
		lanes.some(
			(lane, index) =>
				!allowed.has(lane as MemongoControlReadinessLane) ||
				lanes.indexOf(lane) !== index,
		)
	) {
		throw new Error(
			"MEMONGO_READINESS_CONTROL_LANES must contain unique control, embedding, or vector values",
		)
	}
	if (!controlApiKey) {
		throw new Error(
			"MEMONGO_CONTROL_API_KEY is required when control readiness lanes are configured",
		)
	}
	return lanes as MemongoControlReadinessLane[]
}

export function resolveMemongoRuntimeConfig(
	env: NodeJS.ProcessEnv = process.env,
): MemongoRuntimeConfig {
	const controlApiKey = env.MEMONGO_CONTROL_API_KEY?.trim() || undefined
	return {
		baseUrl: required(env, "MEMONGO_API_URL"),
		tenantApiKey: required(env, "MEMONGO_API_KEY"),
		...(controlApiKey ? { controlApiKey } : {}),
		expectedVersion: MEMONGO_CONTRACT_VERSION,
		expectedContractSha256: MEMONGO_CONTRACT_SHA256,
		timeoutMs: optionalNumber(env, "MEMONGO_TIMEOUT_MS", 10_000, 1),
		compatibilityTtlMs: optionalNumber(
			env,
			"MEMONGO_COMPATIBILITY_TTL_MS",
			60_000,
			0,
		),
		allowInsecureLocal: env.MEMONGO_ALLOW_INSECURE_LOCAL === "1",
		readinessControlLanes: readinessControlLanes(env, controlApiKey),
	}
}

let runtime:
	| {
			config: MemongoRuntimeConfig
			gateway: MemongoMemoryGateway
	  }
	| undefined

function getMemongoRuntime() {
	if (!runtime) {
		const config = resolveMemongoRuntimeConfig()
		const { readinessControlLanes: _, ...clientOptions } = config
		runtime = {
			config,
			gateway: new MemongoMemoryGateway(new MemongoHttpClient(clientOptions)),
		}
	}
	return runtime
}

export function getMemongoGateway(): MemongoMemoryGateway {
	return getMemongoRuntime().gateway
}

export async function checkMemongoReadiness(): Promise<
	MemongoReadinessReport & {
		contractVersion: string
		contractSha256: string
	}
> {
	const { config, gateway } = getMemongoRuntime()
	const report = await gateway.checkReadiness({
		agentId: process.env.MDBRAIN_AGENT_ID?.trim() || "main",
		requiredControlLanes: config.readinessControlLanes,
		timeoutMs: config.timeoutMs,
	})
	return {
		contractVersion: MEMONGO_CONTRACT_VERSION,
		contractSha256: MEMONGO_CONTRACT_SHA256,
		...report,
	}
}
