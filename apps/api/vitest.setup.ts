// API tests exercise /v1 routes as the unauthenticated development principal
// by default. The fail-open development gate is opt-in at runtime (app.ts:
// MDBRAIN_ALLOW_DEV_PRINCIPAL=1), so tests opt in here once; tests that
// verify the gate itself delete the variable explicitly.
process.env.MDBRAIN_ALLOW_DEV_PRINCIPAL ??= "1"
