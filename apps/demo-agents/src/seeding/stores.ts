import type { Collection, Db, Filter, UpdateFilter } from "mongodb"
import type { ManifestStore, RunManifestDoc } from "./manifest.js"
import type { SlotDoc, SlotStore } from "./pool.js"

/** Control-store collections for run slots and run manifests, written
 * directly (plan 11: control data lives in `mdbrain_demo_control`). The
 * driver collection satisfies the same narrow ports the unit tests drive
 * with FakeCollection; the casts only bridge the driver's rich filter
 * types, the operations themselves are identical. */
export function createControlStores(db: Db) {
	const slots = db.collection<SlotDoc>("demo_run_slots")
	const manifests = db.collection<RunManifestDoc>("demo_run_manifests")
	return {
		slots,
		manifests,
		slotStore: adaptSlotStore(slots),
		manifestStore: adaptManifestStore(manifests),
	}
}

function adaptSlotStore(collection: Collection<SlotDoc>): SlotStore {
	return {
		findOne: (filter) => collection.findOne(filter as Filter<SlotDoc>),
		findOneAndUpdate: (filter, update, options) =>
			collection.findOneAndUpdate(
				filter as Filter<SlotDoc>,
				update as UpdateFilter<SlotDoc>,
				options ?? {},
			),
	}
}

function adaptManifestStore(
	collection: Collection<RunManifestDoc>,
): ManifestStore {
	return {
		findOne: (filter) => collection.findOne(filter as Filter<RunManifestDoc>),
		findOneAndUpdate: (filter, update, options) =>
			collection.findOneAndUpdate(
				filter as Filter<RunManifestDoc>,
				update as UpdateFilter<RunManifestDoc>,
				options ?? {},
			),
	}
}
