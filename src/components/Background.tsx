"use client"

import FlickeringGrid from "@/components/flickering-grid"
import dynamic from "next/dynamic"

const DotPattern = dynamic(() => import("@/components/dot-pattern"), {
  ssr: false,
})

const Background = () => {
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
            rgba(255, 255, 255, 0) 100%
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
          background-size: 10px 10px;
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
          squareSize={4}
          gridGap={6}
          flickerChance={0.46} // ~+31%
          maxOpacity={0.33} // ~+32%
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

      <div className="absolute inset-0 hidden md:block" style={{ zIndex: 2 }}>
        <DotPattern cr={1} width={20} height={20} glow className="text-fuchsia-300/35" />
      </div>
    </div>
  )
}

export default Background
