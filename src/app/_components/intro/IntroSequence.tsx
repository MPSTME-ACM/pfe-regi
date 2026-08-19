'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import FlickeringGrid from '@/components/flickering-grid';
import { PixelGrid } from './PixelGrid';

const WORDS = ['ACM', 'PFE'] as const;
type Word = (typeof WORDS)[number];

// Both words mount at t=0; the inactive one sits at opacity-0 so its cells
// finish revealing (~650ms) well before HOLD_MS ends, then the crossfade is a
// dissolve between two already-settled grids — no blank frame in between.
const HOLD_MS = 900;
const CROSSFADE_MS = 650;
const POST_CROSSFADE_HOLD_MS = 900;
const OVERLAY_FADE_MS = 400;
const SCRIM_SOLIDIFY_MS = 300;

/**
 * Renders `children` immediately (so the form mounts/hydrates underneath)
 * behind an opaque ACM -> PFE pixel-reveal overlay, then fades the overlay
 * out. Skips straight to `children` under prefers-reduced-motion.
 */
export function IntroSequence({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(true);
  const [overlayVisible, setOverlayVisible] = React.useState(true);
  const [scrimSolid, setScrimSolid] = React.useState(false);
  const [active, setActive] = React.useState<Word>('ACM');

  React.useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMounted(false);
      return;
    }

    const revealAt = HOLD_MS + CROSSFADE_MS + POST_CROSSFADE_HOLD_MS;
    const timers = [
      setTimeout(() => setActive('PFE'), HOLD_MS),
      // Solidify the scrim just ahead of the overlay's own fade, so it's fully
      // opaque by the time the real form starts showing through underneath.
      setTimeout(() => setScrimSolid(true), revealAt - SCRIM_SOLIDIFY_MS),
      setTimeout(() => setOverlayVisible(false), revealAt),
      setTimeout(() => setMounted(false), revealAt + OVERLAY_FADE_MS),
    ];

    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <>
      {children}
      {mounted && (
        <div
          className={cn(
            'fixed inset-0 z-50 flex items-center justify-center p-6 transition-opacity ease-in-out',
            overlayVisible ? 'opacity-100' : 'opacity-0 pointer-events-none',
          )}
          style={{ transitionDuration: `${OVERLAY_FADE_MS}ms` }}
          aria-hidden="true"
        >
          {/* Same brand flicker the form sits over, dimmed, behind an opaque-ish
           * scrim so it reads as ambient rather than revealing the page underneath. */}
          <FlickeringGrid
            squareSize={8}
            gridGap={12}
            flickerChance={0.4}
            maxOpacity={0.14}
            color="hsl(290 100% 70%)"
          />
          <div
            className={cn(
              'absolute inset-0 z-0 transition-colors ease-in-out',
              scrimSolid ? 'bg-background' : 'bg-background/60',
            )}
            style={{ transitionDuration: `${SCRIM_SOLIDIFY_MS}ms` }}
          />
          <div className="relative z-10 w-full max-w-xl scale-95 sm:scale-100 transition-transform duration-500">
            {WORDS.map((word) => (
              <div
                key={word}
                className={cn(
                  word === 'ACM' ? '' : 'absolute inset-0',
                  'transition-opacity ease-in-out',
                  active === word ? 'opacity-100' : 'opacity-0',
                )}
                style={{ transitionDuration: `${CROSSFADE_MS}ms` }}
              >
                <PixelGrid text={word} />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
