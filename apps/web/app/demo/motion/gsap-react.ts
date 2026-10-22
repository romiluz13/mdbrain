"use client"

import { useGSAP } from "@gsap/react"
import gsap from "gsap"

// Registered once so `useGSAP` and the `gsap` import share one instance.
gsap.registerPlugin(useGSAP)

export { gsap, useGSAP }
