export const DEMO_MODEL = "claude-haiku-5-5"
export const CORPUS_SEED = 20261020
export const CORPUS_BUDGET_KEY = "corpus:northstar"
export const CORPUS_CEILING_ENV = "DEMO_CORPUS_TOKENS"
export const CONTROL_DATABASE = "mdbrain_demo_control"
// The budget bounds input by UTF-8 bytes of the serialized call; a repair
// turn carries the first reply, measured at up to 9,287 bytes (task 309).
export const MAX_INPUT_TOKENS = 12000
