// The narrow port the presenter services use over the demo control database,
// and the one adapter that binds it to the mongodb driver. Every service and
// test is written against the port, so the lease, session and request logic
// runs on an in-memory fake and the driver is touched in this file only.
//
// Server-only: the driver and the connection string never reach a browser
// bundle.

export const CONTROL_COLLECTIONS = {
	manifests: "demo_run_manifests",
	leases: "demo_presenter_leases",
	sessions: "demo_presenter_sessions",
	runRequests: "demo_run_requests",
	publicRun: "demo_public_run",
} as const

export class DuplicateKeyError extends Error {
	name = "DuplicateKeyError"
}

export type FindOneAndUpdateOptions = {
	returnDocument?: "before" | "after"
	sort?: Record<string, 1 | -1>
}

export interface ControlCollection<T extends { _id: string }> {
	findOne(filter: Record<string, unknown>): Promise<T | null>
	find(filter: Record<string, unknown>): Promise<T[]>
	/** Rejects with DuplicateKeyError when `_id` (or a unique field) is taken. */
	insertOne(doc: T): Promise<void>
	findOneAndUpdate(
		filter: Record<string, unknown>,
		update: Record<string, unknown>,
		options?: FindOneAndUpdateOptions,
	): Promise<T | null>
	deleteOne(filter: Record<string, unknown>): Promise<number>
	deleteMany(filter: Record<string, unknown>): Promise<number>
}

const DUPLICATE_KEY = 11000

/** The slice of a driver collection the adapter calls, named structurally so
 * the driver is imported by ./run-store.ts and nowhere else in the web app (a
 * test holds that). A driver `Collection` satisfies it. */
export interface DriverCollectionShape {
	findOne(filter: Record<string, unknown>): Promise<unknown>
	find(filter: Record<string, unknown>): { toArray(): Promise<unknown[]> }
	insertOne(doc: never): Promise<unknown>
	findOneAndUpdate(
		filter: Record<string, unknown>,
		update: Record<string, unknown>,
		options: {
			returnDocument: "before" | "after"
			sort?: Record<string, 1 | -1>
		},
	): Promise<unknown>
	deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }>
	deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount: number }>
}

/** Binds the port to a driver collection. The casts only bridge the driver's
 * rich filter types; the operations are the ones the services name. */
export function driverCollection<T extends { _id: string }>(
	collection: DriverCollectionShape,
): ControlCollection<T> {
	return {
		findOne: async (filter) =>
			(await collection.findOne(filter)) as unknown as T | null,
		find: async (filter) =>
			(await collection.find(filter).toArray()) as unknown as T[],
		insertOne: async (doc) => {
			try {
				await collection.insertOne(doc as never)
			} catch (error) {
				if ((error as { code?: unknown } | null)?.code === DUPLICATE_KEY) {
					throw new DuplicateKeyError("duplicate key")
				}
				throw error
			}
		},
		findOneAndUpdate: async (filter, update, options) =>
			(await collection.findOneAndUpdate(filter, update, {
				returnDocument: options?.returnDocument ?? "after",
				...(options?.sort ? { sort: options.sort } : {}),
			})) as unknown as T | null,
		deleteOne: async (filter) =>
			(await collection.deleteOne(filter)).deletedCount,
		deleteMany: async (filter) =>
			(await collection.deleteMany(filter)).deletedCount,
	}
}
