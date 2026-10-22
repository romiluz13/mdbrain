# Demo 3D and motion: what bit us

Read this before you change `apps/web/app/demo/scene/` or `apps/web/app/demo/motion/`. Each entry comes from an incident while the 3D brain and the story's motion were built. It lists the trigger, the cause, the rule and the check that catches a repeat.

## Read a GSAP-tweened value through a copy that names its keys

Trigger: the scene seam's pose came back as zeros after the camera flew. Cause: `{ ...store.pose }` copied GSAP's `_gsap` bookkeeping tag onto the seam's pose, and `toFixed` then threw inside the sampler's frame callback. Rule: read a value GSAP tweens through a function that names its keys, `copyPose` in `lib/demo-data/camera-pose.ts`. A spread or a `structuredClone` of it carries the tag. Check: `camera-pose.test.ts` ("copyPose") asserts the copy's keys, and `demo-scene.e2e.ts` asserts the seam's pose carries no GSAP bookkeeping.

## Ask for the next frame inside `useFrame` while the scene moves

Trigger: the phone's chapter 5 flight drew 36.5 fps while the page ticked at 60. Cause: with `frameloop="demand"`, R3F answers an `invalidate()` one frame late and then stops, so a GSAP-driven move drew every other frame. Rule: call `invalidate()` inside `useFrame` for as long as the scene drifts or flies. Check: the fps bound in `e2e/demo-bounds.e2e.ts`, run on a production build with `DEMO_BOUNDS=1`.

## Draw page titles as DOM

Trigger: leaving a chapter raised React unmount errors. Cause: a drei `Html` root per label. Rule: titles are `CSS2DObject`s in `LabelLayer` (`scene/scene-marks.tsx`). Check: `e2e/demo-journey.ts` fails on any console or page error across the nine chapters, and `e2e/demo-remount.e2e.ts` on any page error over three leaves and returns.

## Count leaks after R3F has let go, on reachable targets only

Trigger: leak counts read a context too many right after leaving chapter 1, and listeners read +7 a cycle. Cause: R3F disposes the GL context about 500 ms after the canvas unmounts, and React-attached listeners on detached nodes are collected with the node. Rule: wait 1.2 s before you count contexts, and count a listener only while its target is connected (`INSTRUMENT` in `e2e/demo-bounds-kit.ts`). Check: `e2e/demo-remount.e2e.ts` and the chapter 1 to 9 to 1 bound.

## Give every effect the cleanup that undoes its setup

Trigger: 338 saw doubled requests on `/demo` in `next dev`. Cause: Strict Mode runs one extra setup, cleanup, setup cycle for every Effect in development (React's Strict Mode reference; `reactStrictMode: true` in `apps/web/next.config.ts`, and the app router's default since Next 13.5.1). Rule: tween contexts go through `useGSAP`, which reverts them in the cleanup; listeners and subscriptions are removed; reads abort with the effect (`use-demo-data.ts` passes one `AbortSignal` to every loader). R3F keeps a canvas that is mounted again and releases it only when it truly leaves. Check: `e2e/demo-remount.e2e.ts` runs under `next dev` and a production build, and fails when a cleanup is removed.

## Wait for motion before a tap or a measurement

Trigger: the phone journey missed a tap in chapter 5 on about one run in four, and the stepper's gap read 6 px. Cause: the beat's source slips and the stepper's enter tween were still moving, and `html { scroll-behavior: smooth }` keeps a tap's own scroll-into-view moving while it hit-tests, with the sticky banner and stepper covering the target. Rule: call `settled(page)` first, then centre the target with an instant scroll. Check: `withTouch` in `e2e/demo-journey.ts`; the touch journey passes 16 of 16 runs on a production build.
