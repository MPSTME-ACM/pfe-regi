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
          transform: translate(-50%, -50%) rotate(-24deg);
        }
      `}</style>

      {/* Dim base behind everything for contrast (reduced to let colors pop more) */}
      <div className="absolute inset-0" style={{ backgroundColor: "#0a0a0a", opacity: 0.55, zIndex: 0 }} />

      {/* Main flickering pixel grid - stronger by ~30% */}
      <div className="absolute inset-0" style={{ zIndex: 1 }}>
        <FlickeringGrid
          squareSize={4}
          gridGap={6}
          flickerChance={0.46} // was 0.35 (~+31%)
          maxOpacity={0.33} // was 0.25 (~+32%)
          color="hsl(290 100% 70%)" // brighter magenta/purple in same family
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

      {/* Slightly stronger dot glow overlay for liveliness */}
      <div className="absolute inset-0" style={{ zIndex: 2 }}>
        <DotPattern cr={1} width={20} height={20} glow className="text-fuchsia-300/35" />
      </div>
    </div>
  )
}

export default Background
