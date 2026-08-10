"use client"

import { usePathname } from "next/navigation"
import FlickeringGrid from "@/components/flickering-grid"

/**
 * Staff tools. These render on opaque panel surfaces instead.
 *
 * A flickering canvas grid and a drifting blurred ray are the brand on the
 * registration page and noise behind a form, a table or a chart. Returning null
 * here UNMOUNTS the canvas rather than covering it, which also stops it burning
 * CPU on the phone running /verify at the venue door.
 */
const STAFF_ROUTES = ["/admin", "/stats", "/sync", "/verify"]

const isStaffRoute = (pathname: string) =>
  // Boundary-matched, so a future /admin/coupons is covered but a hypothetical
  // /verifying is not.
  STAFF_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))

const Background = () => {
  // Resolves during SSR as well as on the client, so the server HTML and the
  // first client render agree — no hydration mismatch. The element is
  // `fixed … -z-10`, so unmounting it shifts no layout.
  const pathname = usePathname()
  if (isStaffRoute(pathname)) return null

  return (
    <div aria-hidden className="fixed inset-0 -z-10">
      {/* Animated helpers for the diagonal ray */}
      <style jsx global>{`
        @keyframes v0-rayPulse {
          0% { opacity: 0.38 }
          50% { opacity: 0.7 }
          100% { opacity: 0.38 }
        }
        @keyframes v0-rayDrift {
          0% { transform: translate(-50%, -50%) rotate(-24deg) translateX(-6%) }
          50% { transform: translate(-50%, -50%) rotate(-24deg) translateX(6%) }
          100% { transform: translate(-50%, -50%) rotate(-24deg) translateX(-6%) }
        }
        /* Mobile-friendly, CSS-only subtle flicker (no canvas, ultra low RAM) */
        @keyframes v0-softPulse {
          0% { opacity: 0.18 }
          50% { opacity: 0.32 }
          100% { opacity: 0.18 }
        }
        .v0-ray {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 160vw;
          height: 34vh;
          pointer-events: none;
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0) 0%,
            rgba(255, 170, 255, 0.95) 50%,
            rgba(255, 255, 255, 0) 80%
          );
          filter: blur(34px);
          mix-blend-mode: screen;
          animation: v0-rayPulse 5.5s ease-in-out infinite, v0-rayDrift 12s ease-in-out infinite;
          transform: translate(-50%, -50%) rotate(-24deg) translateZ(0);
          will-change: transform, opacity;
          backface-visibility: hidden;
          contain: paint; /* isolate paint to this layer */
        }
        /* Mobile (CSS-only) pixel grid and subtle pulse */
        .v0-mobile-grid {
          position: absolute;
          inset: 0;
          pointer-events: none;
          color: hsl(290 100% 70% / 0.28); /* same family, low alpha */
          background-image: radial-gradient(currentColor 1px, transparent 1px);
          background-size: 20px 20px;
          will-change: opacity;
          contain: paint;
        }
        .v0-mobile-flicker {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image: radial-gradient(hsl(300 100% 85% / 0.25) 1px, transparent 1px);
          background-size: 10px 10px;
          mix-blend-mode: screen;
          animation: v0-softPulse 6s ease-in-out infinite;
          will-change: opacity;
          contain: paint;
        }
      `}</style>

      {/* Dim base behind everything for contrast (reduced to let colors pop more) */}
      <div className="absolute inset-0" style={{ backgroundColor: "#0a0a0a", opacity: 0.55, zIndex: 0 }} />

      <div className="absolute inset-0 md:hidden" style={{ zIndex: 1 }}>
        <div className="v0-mobile-grid" />
        <div className="v0-mobile-flicker" />
      </div>

      <div className="absolute inset-0 hidden md:block" style={{ zIndex: 1 }}>
        <FlickeringGrid
          squareSize={8}
          gridGap={12}
          flickerChance={0.46}
          maxOpacity={0.33}
          color="hsl(290 100% 70%)"
        />
      </div>

      {/* Subtle color wash in pink/purple to enrich the grid tint */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          zIndex: 2,
          mixBlendMode: "screen",
          background:
            "radial-gradient(120% 60% at 50% 40%, rgba(252, 105, 255, 0.22), rgba(140, 88, 255, 0.16), rgba(0,0,0,0) 70%)",
        }}
      />

      {/* Diagonal bright ray through the middle */}
      <div className="v0-ray" style={{ zIndex: 3 }} />

      <div
        className="absolute inset-0 hidden md:block opacity-35"
        style={{
          zIndex: 2,
          backgroundImage: `radial-gradient(circle at center, rgba(196, 181, 253, 0.4) 1px, transparent 1px)`,
          backgroundSize: '20px 20px',
          animation: 'v0-softPulse 8s ease-in-out infinite'
        }}
      />
    </div>
  )
}

export default Background
