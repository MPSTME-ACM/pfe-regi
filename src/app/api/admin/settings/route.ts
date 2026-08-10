import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getSettings, updateSettings, type SettingsPatch } from '@/lib/settings';
import { DEFAULT_FIELD_LABELS, type EventConfig, type FieldOptions, type FieldLabels } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  const settings = await getSettings();
  return NextResponse.json({ success: true, settings });
}

// ─── validation ──────────────────────────────────────────────────────────────
// Hand-rolled rather than pulling in a schema library: this is one endpoint with
// nine fields. The rule is whitelist-only — anything not named here is dropped,
// so a client cannot smuggle in `id` or `updatedAt`.

const MAX_PRICE_PAISE = 10_000_00; // ₹10,000. A typo'd extra zero should not ship.

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function parseEventConfig(v: unknown, errors: string[]): EventConfig | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null) {
    errors.push('eventConfig must be an object');
    return undefined;
  }
  const o = v as Record<string, unknown>;
  const keys = ['dateRange', 'timeRange', 'venue', 'contactEmail', 'whatsappUrl'] as const;
  for (const k of keys) {
    if (typeof o[k] !== 'string') {
      errors.push(`eventConfig.${k} must be a string`);
      return undefined;
    }
  }
  return {
    dateRange: o.dateRange as string,
    timeRange: o.timeRange as string,
    venue: o.venue as string,
    contactEmail: o.contactEmail as string,
    whatsappUrl: o.whatsappUrl as string,
  };
}

function parseFieldOptions(v: unknown, errors: string[]): FieldOptions | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null) {
    errors.push('fieldOptions must be an object');
    return undefined;
  }
  const o = v as Record<string, unknown>;
  const keys = ['colleges', 'courses', 'departments', 'years'] as const;
  for (const k of keys) {
    if (!isStringArray(o[k])) {
      errors.push(`fieldOptions.${k} must be an array of strings`);
      return undefined;
    }
    if ((o[k] as string[]).length === 0) {
      errors.push(`fieldOptions.${k} cannot be empty — the form would render an unusable dropdown`);
      return undefined;
    }
  }
  return {
    colleges: o.colleges as string[],
    courses: o.courses as string[],
    departments: o.departments as string[],
    years: o.years as string[],
  };
}

/**
 * Field wording. Only the eight known keys are accepted and only the three known
 * sub-keys within each, so an admin cannot introduce a ninth field by PATCH.
 *
 * A blank `label` is rejected: the form would render a required field with no
 * visible name, which is unusable and not obviously a mistake from this screen.
 * A blank `placeholder` is fine — it just means no grey hint.
 */
function parseFieldLabels(v: unknown, errors: string[]): FieldLabels | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null) {
    errors.push('fieldLabels must be an object');
    return undefined;
  }
  const o = v as Record<string, unknown>;
  const out = {} as FieldLabels;

  for (const key of Object.keys(DEFAULT_FIELD_LABELS) as (keyof FieldLabels)[]) {
    const raw = o[key];
    if (typeof raw !== 'object' || raw === null) {
      errors.push(`fieldLabels.${key} must be an object`);
      return undefined;
    }
    const f = raw as Record<string, unknown>;

    if (typeof f.label !== 'string' || f.label.trim() === '') {
      errors.push(`fieldLabels.${key}.label must be a non-empty string`);
      return undefined;
    }
    if (typeof f.placeholder !== 'string') {
      errors.push(`fieldLabels.${key}.placeholder must be a string`);
      return undefined;
    }
    if (f.selectPrompt !== undefined && typeof f.selectPrompt !== 'string') {
      errors.push(`fieldLabels.${key}.selectPrompt must be a string`);
      return undefined;
    }

    out[key] = {
      label: f.label,
      placeholder: f.placeholder,
      // Empty string means "fall back to the built-in prompt", which is what an
      // admin who clears the box expects. Storing "" would blank the dropdown.
      ...(typeof f.selectPrompt === 'string' && f.selectPrompt !== ''
        ? { selectPrompt: f.selectPrompt }
        : {}),
    };
  }
  return out;
}

function parsePrice(v: unknown, field: string, errors: string[]): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    errors.push(`${field} must be an integer number of paise (₹250 is 25000)`);
    return undefined;
  }
  if (v < 0 || v > MAX_PRICE_PAISE) {
    errors.push(`${field} must be between 0 and ${MAX_PRICE_PAISE} paise`);
    return undefined;
  }
  return v;
}

function buildPatch(body: unknown): { patch: SettingsPatch } | { errors: string[] } {
  if (typeof body !== 'object' || body === null) {
    return { errors: ['body must be a JSON object'] };
  }
  const o = body as Record<string, unknown>;
  const errors: string[] = [];
  const patch: SettingsPatch = {};

  if (o.registrationOpen !== undefined) {
    if (typeof o.registrationOpen !== 'boolean') errors.push('registrationOpen must be a boolean');
    else patch.registrationOpen = o.registrationOpen;
  }
  for (const field of ['closedTitle', 'closedBody'] as const) {
    if (o[field] !== undefined) {
      if (typeof o[field] !== 'string') errors.push(`${field} must be a string`);
      else patch[field] = o[field] as string;
    }
  }
  for (const field of ['priceCapstone', 'priceSingle', 'priceBundle'] as const) {
    const parsed = parsePrice(o[field], field, errors);
    if (parsed !== undefined) patch[field] = parsed;
  }

  const eventConfig = parseEventConfig(o.eventConfig, errors);
  if (eventConfig) patch.eventConfig = eventConfig;

  const fieldOptions = parseFieldOptions(o.fieldOptions, errors);
  if (fieldOptions) patch.fieldOptions = fieldOptions;

  const fieldLabels = parseFieldLabels(o.fieldLabels, errors);
  if (fieldLabels) patch.fieldLabels = fieldLabels;

  if (errors.length) return { errors };
  if (Object.keys(patch).length === 0) return { errors: ['no recognised fields in body'] };
  return { patch };
}

export async function PATCH(request: Request) {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: 'Invalid JSON body' }, { status: 400 });
  }

  const result = buildPatch(body);
  if ('errors' in result) {
    return NextResponse.json({ success: false, message: result.errors.join('; ') }, { status: 400 });
  }

  try {
    const settings = await updateSettings(result.patch);
    // Leaves an audit trail in the container logs for the one setting that
    // matters most — "who opened registration and when" is worth being able
    // to answer after the fact.
    if (result.patch.registrationOpen !== undefined) {
      console.log(`[settings] registrationOpen -> ${result.patch.registrationOpen}`);
    }
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('[settings] update failed:', error);
    return NextResponse.json({ success: false, message: 'Failed to save settings' }, { status: 500 });
  }
}
