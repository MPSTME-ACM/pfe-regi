'use client';

import * as React from 'react';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { letterPatterns } from './letterPatterns';

// Brand hues from globals.css --color-accent / --color-accent-deep /
// --color-accent-soft, duplicated here (like theme.ts and Background.tsx)
// because each cell's colour is chosen randomly in JS, not via a CSS class.
const INTRO_COLORS = ['#e97bfc', '#ad22c2', '#f8c8fc'];

function cleanText(str: string): string {
  const allowed = Object.keys(letterPatterns);
  return str
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split('')
    .filter((char) => allowed.includes(char))
    .join('');
}

function layoutCells(text: string) {
  const cleaned = cleanText(text);
  const width = Math.max(cleaned.length * 6, 6) + 1;
  const highlighted: number[] = [];
  let position = 1;

  cleaned.split('').forEach((char) => {
    const pattern = letterPatterns[char] ?? [];
    pattern.forEach((pos) => {
      const row = Math.floor(pos / 50);
      const col = pos % 50;
      highlighted.push((row + 1) * width + col + position);
    });
    position += 6;
  });

  return { highlighted, width, height: 9 };
}

/**
 * Dot-matrix "ACM"/"PFE" reveal grid for the registration-form intro.
 * Ported from Code/merch's CommitsGrid, retimed faster and recoloured to the
 * PFE accent palette instead of ACM's blue.
 */
export function PixelGrid({ text }: { text: string }) {
  const { highlighted, width, height } = React.useMemo(
    () => layoutCells(text),
    [text],
  );

  const [cellStyles, setCellStyles] = React.useState<
    { delay: string; color: string; flash: boolean }[]
  >([]);

  React.useEffect(() => {
    setCellStyles(
      Array.from({ length: width * height }).map(() => ({
        delay: `${(Math.random() * 0.25).toFixed(2)}s`,
        color: INTRO_COLORS[Math.floor(Math.random() * INTRO_COLORS.length)],
        flash: Math.random() < 0.3,
      })),
    );
  }, [width, height]);

  return (
    <section
      className="w-full max-w-xl bg-panel border border-hairline grid p-1.5 sm:p-3 gap-0.5 sm:gap-1 rounded-[10px] sm:rounded-[15px]"
      style={{
        gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${height}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: width * height }).map((_, index) => {
        const isHighlighted = highlighted.includes(index);
        const style = cellStyles[index] ?? { delay: '0s', color: INTRO_COLORS[0], flash: false };
        const shouldFlash = !isHighlighted && style.flash;

        return (
          <div
            key={index}
            className={cn(
              'border border-hairline h-full w-full aspect-square rounded-[4px] sm:rounded-[3px]',
              isHighlighted ? 'animate-intro-reveal' : '',
              shouldFlash ? 'animate-intro-flash' : '',
              !isHighlighted && !shouldFlash ? 'bg-intro-cell' : '',
            )}
            style={
              {
                animationDelay: style.delay,
                '--highlight': style.color,
              } as CSSProperties
            }
          />
        );
      })}
    </section>
  );
}
