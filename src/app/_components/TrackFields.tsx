'use client';

import React from 'react';
import { SelectField, type SelectOption } from './FormFields';
import { formatDates, type TrackOption } from './registrationTypes';
import type { Sku } from '@/lib/pricing/resolvePrice';

// The track selects, driven entirely by the chosen SKU:
//   capstone -> none (the capstone day is not a track)
//   single   -> ONE select holding every beginner AND advanced track, grouped
//   bundle   -> TWO selects, one per segment
//
// A full track is rendered disabled with a "(Full)" suffix rather than being
// dropped from the list: a student who came for Python should be told Python is
// gone, not left wondering why it is missing.

/** Must match the slug the tracks table uses for the capstone day. */
const CAPSTONE_SLUG = 'capstone';

export type TrackFieldName = 'singleTrack' | 'beginnerTrack' | 'advancedTrack';

function toOption(track: TrackOption, group?: string): SelectOption {
  return {
    value: track.slug,
    label: track.full ? `${track.name} (Full)` : track.name,
    disabled: track.full,
    group,
  };
}

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
function segmentLabel(prefix: string, list: TrackOption[]): string {
  const when = formatDates(segmentDates(list));
  return when ? `${prefix} — ${when}` : prefix;
}

function runsOn(dates: string[]): string | undefined {
  const when = formatDates(dates);
  return when ? `Runs on ${when}.` : undefined;
}

function datesHint(tracks: TrackOption[], slug: string): string | undefined {
  const track = tracks.find((t) => t.slug === slug);
  return track ? runsOn(track.dates) : undefined;
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

  const handle = (name: TrackFieldName) => (e: React.ChangeEvent<HTMLSelectElement>) =>
    onChange(name, e.target.value);

  if (sku === '') return null;

  if (sku === 'capstone') {
    return (
      <p className="mb-6 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-400">
        The capstone day has no track to choose
        {capstone?.dates.length ? ` — it runs on ${formatDates(capstone.dates)}` : ''}.
      </p>
    );
  }

  if (sku === 'single') {
    return (
      <SelectField
        label="Choose your track"
        name="singleTrack"
        placeholder="Select a track"
        value={singleTrack}
        onChange={handle('singleTrack')}
        required
        hint={datesHint(tracks, singleTrack) ?? 'One track, both of its days.'}
        options={[
          ...beginners.map((t) => toOption(t, segmentLabel('Beginner', beginners))),
          ...advanced.map((t) => toOption(t, segmentLabel('Advanced', advanced))),
        ]}
      />
    );
  }

  return (
    <>
      <SelectField
        label="Beginner track"
        name="beginnerTrack"
        placeholder="Select a beginner track"
        value={beginnerTrack}
        onChange={handle('beginnerTrack')}
        required
        hint={datesHint(tracks, beginnerTrack) ?? runsOn(segmentDates(beginners))}
        options={beginners.map((t) => toOption(t))}
      />
      <SelectField
        label="Advanced track"
        name="advancedTrack"
        placeholder="Select an advanced track"
        value={advancedTrack}
        onChange={handle('advancedTrack')}
        required
        hint={datesHint(tracks, advancedTrack) ?? runsOn(segmentDates(advanced))}
        options={advanced.map((t) => toOption(t))}
      />
      <p className="mb-6 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-400">
        {capstone?.full
          ? 'The capstone day is full, so the bundle cannot be booked right now.'
          : `The capstone day${capstone?.dates.length ? ` (${formatDates(capstone.dates)})` : ''} is included.`}
      </p>
    </>
  );
}
