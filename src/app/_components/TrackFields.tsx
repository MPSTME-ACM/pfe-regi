'use client';

import React from 'react';
import OptionCard from './OptionCard';
import { formatDates, suggestedAdvancedFor, type TrackOption } from './registrationTypes';
import type { Sku } from '@/lib/pricing/resolvePrice';

// The track pickers, driven entirely by the chosen SKU:
//   capstone -> none (the capstone day is not a track)
//   single   -> one group holding every beginner AND advanced track
//   bundle   -> two groups, one per segment
//
// Cards rather than <select>s, matching the SKU chooser above them: with six
// options total there is no reason to hide five of them behind a dropdown, and
// a card can carry the dates and a full/suggested marker that an <option> label
// cannot. Same OptionCard component as the SKU chooser, so they cannot drift.
//
// A full track is rendered disabled rather than dropped: a student who came for
// Python should be told Python is gone, not left wondering where it went.

/** Must match the slug the tracks table uses for the capstone day. */
const CAPSTONE_SLUG = 'capstone';

export type TrackFieldName = 'singleTrack' | 'beginnerTrack' | 'advancedTrack';

/** Every date any track in a segment runs on, de-duplicated and sorted. */
function segmentDates(list: TrackOption[]): string[] {
  return [...new Set(list.flatMap((t) => t.dates))].sort();
}

/**
 * Dates are read off the `tracks` rows, never written in here.
 *
 * 2025 kept the domain list and the workshop dates in three files that had to be
 * edited together, and CLAUDE.md lists that as a landmine. The tracks table is
 * what retires it, so a literal date in this file would put it straight back:
 * the admin panel can move a track and nothing would catch the drift.
 */
function Legend({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <legend className="mb-3 block text-sm font-medium text-gray-300">
      {children} <span className="text-[#e97bfc]">*</span>
      {hint && <span className="mt-0.5 block text-xs font-normal text-gray-500">{hint}</span>}
    </legend>
  );
}

function TrackGrid({
  name,
  tracks,
  value,
  onSelect,
  suggested,
  required,
}: {
  name: TrackFieldName;
  tracks: TrackOption[];
  value: string;
  onSelect: (slug: string) => void;
  /** Slug to nudge toward. Rendered as a badge, never auto-selected. */
  suggested?: string | null;
  required?: boolean;
}) {
  // The browser validates a radio group by name, so `required` on one member is
  // enough. It has to go on a SELECTABLE one: `required` on a disabled input is
  // ignored, so pinning it to index 0 would silently drop validation for the
  // whole group whenever the first track happens to be full.
  const firstSelectable = tracks.find((t) => !t.full)?.slug;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {tracks.map((track) => {
        const isSuggested = !track.full && track.slug === suggested;
        return (
          <OptionCard
            key={track.slug}
            name={name}
            value={track.slug}
            checked={value === track.slug}
            disabled={track.full}
            onSelect={onSelect}
            title={track.name}
            when={formatDates(track.dates)}
            badge={track.full ? 'Full' : isSuggested ? 'Pairs well' : undefined}
            badgeTone={isSuggested ? 'suggested' : 'accent'}
            required={required && track.slug === firstSelectable}
          />
        );
      })}
    </div>
  );
}

export default function TrackFields({
  sku,
  tracks,
  singleTrack,
  beginnerTrack,
  advancedTrack,
  onChange,
}: {
  sku: Sku | '';
  tracks: TrackOption[];
  singleTrack: string;
  beginnerTrack: string;
  advancedTrack: string;
  onChange: (name: TrackFieldName, value: string) => void;
}) {
  const beginners = tracks.filter((t) => t.segment === 'beginner');
  const advanced = tracks.filter((t) => t.segment === 'advanced');
  const capstone = tracks.find((t) => t.slug === CAPSTONE_SLUG);

  if (sku === '') return null;

  if (sku === 'capstone') {
    return (
      <p className="mb-8 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-400">
        The capstone day has no track to choose
        {capstone?.dates.length ? ` — it runs on ${formatDates(capstone.dates)}` : ''}.
      </p>
    );
  }

  if (sku === 'single') {
    return (
      <fieldset className="mb-8">
        <Legend hint="One track, attended across both of its days.">Choose your track</Legend>

        <p className="mb-2 text-xs font-medium tracking-wide text-gray-400 uppercase">
          Beginner{beginners.length ? ` — ${formatDates(segmentDates(beginners))}` : ''}
        </p>
        <TrackGrid
          name="singleTrack"
          tracks={beginners}
          value={singleTrack}
          onSelect={(slug) => onChange('singleTrack', slug)}
          required
        />

        <p className="mt-5 mb-2 text-xs font-medium tracking-wide text-gray-400 uppercase">
          Advanced{advanced.length ? ` — ${formatDates(segmentDates(advanced))}` : ''}
        </p>
        <TrackGrid
          name="singleTrack"
          tracks={advanced}
          value={singleTrack}
          onSelect={(slug) => onChange('singleTrack', slug)}
        />
      </fieldset>
    );
  }

  // bundle
  const suggestion = beginnerTrack ? suggestedAdvancedFor(beginnerTrack, advanced) : null;

  return (
    <>
      <fieldset className="mb-8">
        <Legend hint={beginners.length ? formatDates(segmentDates(beginners)) : undefined}>
          Beginner track
        </Legend>
        <TrackGrid
          name="beginnerTrack"
          tracks={beginners}
          value={beginnerTrack}
          onSelect={(slug) => onChange('beginnerTrack', slug)}
          required
        />
      </fieldset>

      <fieldset className="mb-8">
        <Legend hint={advanced.length ? formatDates(segmentDates(advanced)) : undefined}>
          Advanced track
        </Legend>
        <TrackGrid
          name="advancedTrack"
          tracks={advanced}
          value={advancedTrack}
          onSelect={(slug) => onChange('advancedTrack', slug)}
          suggested={suggestion?.slug ?? null}
          required
        />
        {suggestion && advancedTrack !== suggestion.slug && (
          <p className="mt-3 text-xs text-gray-400">
            <span className="text-[#f8c8fc]">{suggestion.name}</span> follows on naturally from{' '}
            {beginners.find((t) => t.slug === beginnerTrack)?.name}. Any pairing is allowed.
          </p>
        )}
      </fieldset>

      <p className="mb-8 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-400">
        {capstone?.full
          ? 'The capstone day is full, so the bundle cannot be booked right now.'
          : `The capstone day${capstone?.dates.length ? ` (${formatDates(capstone.dates)})` : ''} is included.`}
      </p>
    </>
  );
}
