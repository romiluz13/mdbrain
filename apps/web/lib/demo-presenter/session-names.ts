// The two names the browser and the server must agree on. Kept apart from
// ./session.ts, which imports node:crypto and so cannot reach a browser bundle.
export const SESSION_COOKIE = "demo_presenter"
export const CSRF_HEADER = "x-demo-csrf"
