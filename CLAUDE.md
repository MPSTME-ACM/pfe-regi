# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm**, pinned via `packageManager` in `package.json` (corepack picks it up automatically).

```bash
cp .env.sample .env          # step 0 — .env is gitignored and does not exist on a fresh clone
pnpm install
pnpm dev                     # next dev --turbopack, localhost:3000
pnpm build                   # next build --turbopack
pnpm start                   # production server
pnpm lint                    # bare `eslint`, flat config
pnpm exec drizzle-kit generate | migrate | push | studio
```

**After pulling a schema change, run `pnpm exec drizzle-kit migrate`.** Migration `0006` creates the `settings` table and seeds its single row; without it `/admin` and the home page fall back to "registration closed" and the panel reports a missing settings row.

- Without a real `DATABASE_URL`, `pnpm dev` still boots and static pages render, but every DB-backed route (`/api/*`, `/stats`, `/sync`, `/verify`) 500s, and the home page falls back to "registration closed".

**Local database in one command** — `src/lib/db/index.ts` skips SSL for `localhost`/`127.0.0.1` and for any URL with `?sslmode=disable`, so a plain container works. Remote hosts keep the permissive `rejectUnauthorized: false` they always had.

```bash
docker run -d --name pfe-db -e POSTGRES_PASSWORD=pfe -e POSTGRES_DB=pfe -p 55432:5432 postgres:16-alpine
# DATABASE_URL=postgres://postgres:pfe@localhost:55432/pfe
pnpm exec drizzle-kit migrate
```
- `pnpm lint` is at **zero errors and zero warnings**. Keep it there — a red lint now means you broke something.
- `next.config.ts` sets `eslint.ignoreDuringBuilds: true`, so `pnpm build` will **not** catch lint errors. Run `pnpm lint` separately.
- **No test framework is installed.** No jest, vitest, or playwright. There is no test command. Phase 2 adds vitest, scoped to the pricing/coupon resolver only.
- `scripts/mail.ts` and `scripts/qrGen.ts` have no wired-up runner. `ts-node` is a dependency but fails on both (`Unknown file extension ".ts"` — the tsconfig is ESM/bundler-oriented and `qrGen.ts` uses top-level await).
  - **`scripts/mail.ts` is the confirmation-email test harness.** Unlike `src/lib/mail/mailUtil.ts`, it takes an `orderId` and generates the QR itself, so you can preview the real email without going through a payment. Edit the placeholder call on the last line (`sendMail("email", "domain", "name", "orderid")`) and run it. **That call fires at module scope**, so importing this file sends an email as a side effect — never import it from app code.
  - Getting it to actually run needs a runner that handles ESM TypeScript (`npx tsx scripts/mail.ts`); plain `ts-node` will not work with this tsconfig.

## Architecture

Next.js 15 App Router + React 19 + Tailwind v4 (via `@tailwindcss/postcss`; there is no `tailwind.config`) + Drizzle ORM over `node-postgres`. `@/*` maps to `./src/*`.

### Two tables

Both in `src/lib/db/schema.ts`.

**`pferegistration`** — every registration feature reads and writes this one table.
- `orderId` is the unique business key that every other module joins on.
- `attendance` is `jsonb` typed as `boolean[]`, defaulting to `[false, false, false]` — one slot per workshop day.

**`settings`** — the singleton config row behind `/admin`. Money is stored in **integer paise**, never floats; convert only at the Cashfree boundary with `paiseToRupees()` in `src/lib/settings.ts`.

### `orderId` is semantic, not opaque

`api/create-order` builds it as `{firstInitial}{lastInitial}{last4OfContact}{last5OfTimestamp}{domainInitial}`. `api/webhook` then decodes the **trailing character** back into a domain name via a `C/P/W/D/A` map to fill in the confirmation email. Changing the ID format silently breaks the webhook's domain lookup.

### Payment → ticket flow

```
/ (page.save.tsx form)
      │  POST
      ▼
api/create-order ──► domain cap check (120/domain, success only)
      │              insert row, paymentStatus='pending'
      │              Cashfree PGCreateOrder
      ▼
Cashfree hosted checkout (@cashfreepayments/cashfree-js)
      │
      ├──► api/webhook   (server-to-server, notify_url)
      │      HMAC-SHA256 over `${timestamp}${rawBody}` vs x-webhook-signature
      │      SUCCESS → qrcode.toDataURL(`${SITE_URL}/verify?orderId=…`)
      │              → paymentStatus='success', store qrCodeUrl
      │              → sendMail() with the QR as a cid attachment
      │      FAILED / USER_DROPPED → paymentStatus='failure'
      │
      └──► /payment-status (client)
             POST api/get-status → re-queries Cashfree directly
             (fallback path; does not trust the DB alone)
```

The webhook needs the **raw unparsed body** for signature verification — `getRawBody()` reads the stream manually. Do not add body parsing ahead of it.

### Attendance scanning

`/verify` scans the ticket QR with `html5-qrcode`, then POSTs to `api/verify` to either read the row or overwrite the 3-slot `attendance` array.

### Google Sheets sync

`api/sync-sheet` pulls the entire table plus all of `Sheet1`, keys the sheet rows by the **`Order ID` column** (looked up by header name, not index), then batch-updates changed rows and appends new ones. Triggered manually from `/sync`, and by an external cron — which is why the Dockerfile installs `curl` ("Need this for Sync Job").

## Opening and closing registration

Go to **`/admin`** and flip the toggle. That is the whole procedure. No commit, no deploy.

The switch is `settings.registrationOpen`, and it gates two places that must stay in sync:

- `src/app/page.tsx` (server component, `dynamic = 'force-dynamic'`) renders `ClosedNotice` or `RegistrationForm`.
- `src/app/api/create-order/route.ts` returns **403 `REGISTRATION_CLOSED`** when the flag is off.

Gating only the page would leave the endpoint accepting POSTs from anyone with the URL. If you add another write endpoint, gate it too.

`settings` is a **singleton row** (`id = 1`, enforced by a check constraint), read through `src/lib/settings.ts`. `getSettings()` never throws — on a DB error it returns `FALLBACK_SETTINGS`, which has `registrationOpen: false`. If we cannot tell whether we are open, we are not open. There is deliberately **no cache** on it; see the landmines below for why.

**Historical note:** before this existed, registration was toggled by renaming five files and committing — every `Close Forms` / `Forms are back up` commit in the log is that. `page.save.tsx` and the `route.disabled.ts` files are gone. **`src/app/member/page.save.tsx` is the one survivor**: the `/member` comp flow still uses the old convention and is reworked in Phase 2.

## Auth

HTTP Basic. Every protected route uses the same helper:

```ts
import { requireAdmin } from '@/lib/auth/requireAdmin';

const auth = requireAdmin(request);   // or requireMember
if (!auth.ok) return auth.response;
```

Admin username is literally `admin` (`ADMIN_PASSWORD`); member is `acm` (`MEMBER_PASSWORD`). The helper fails closed when the env var is unset, and compares passwords with `timingSafeEqual` on equal-**byte**-length buffers (string length is not a safe guard — `'aé'` and `'ab'` are both 2 chars but 3 and 2 bytes, and a mismatch there throws).

On the client, `src/components/admin/AdminGate.tsx` wraps any admin screen: it renders the login form, stores the `Basic …` credential in sessionStorage under `admin-creds`, and hands it to children to replay on fetches. `/admin` uses it. **`/sync`, `/stats` and `/verify` still have their own copy-pasted login forms** — migrate them to `AdminGate` when you next touch them.

This is a shared password replayed from client state, not sessions. Adequate for a committee-run admin panel, but do not build anything more sensitive on it.

## Landmines

- `src/lib/db/index.ts` connects with `ssl: { rejectUnauthorized: false }`.
- **In-memory state that breaks with more than one instance:** the 3-minute per-address email throttle (`lastSentTimes` in `src/lib/mail/mailUtil.ts`) and the 5-minute domain-count cache (`api/domain-count`). Both silently degrade behind a load balancer — two containers hold two different caches and disagree. This is why `getSettings()` is deliberately uncached; do not "optimise" it into a third copy of this bug.
- **`api/webhook` reconstructs the domain from `order_id.slice(-1)`** instead of reading the row. Already broken for comped members, whose order IDs end in `-ACM`: `slice(-1)` gives `M`, the lookup misses, and the email says "the undefined track". Being fixed in Phase 2.
- **`api/create-order` checks capacity then inserts with no transaction**, so two concurrent buyers at the cap both get through. Also Phase 2.
- **`api/webhook` is not idempotent** and Cashfree retries. A retry re-sends the confirmation email; the only thing stopping it is the per-process email throttle above.
- **Comped members are written as `paymentStatus: 'failure'`** (`api/member-register`) so they dodge the capacity check. They are indistinguishable from real payment failures, which makes the percentages in `/stats` wrong.
- The confirmation email is a ~25KB inline HTML template literal in `mailUtil.ts`, compiled from `src/lib/mail/mail.mjml` (currently in sync). **`mjml` is not a project dependency** — regenerating means `npx mjml src/lib/mail/mail.mjml` and pasting the result back into the template literal. Keeping the two files in sync is manual.
- **Event dates, venue and contact details now live in `settings.eventConfig`** and are read by `page.tsx`. But the confirmation email still has its own hardcoded copies in `mailUtil.ts` and `mail.mjml` — Phase 2 wires those to `settings`. Until then, changing a date means editing the panel *and* both email files.
- The **domain list (`C/Python/Web/DSA/AIML`) and the 120-per-domain cap are still hardcoded**, and duplicated between `api/create-order`, `api/domain-count` and `_components/RegistrationForm.tsx`. They must be changed together. Phase 2 replaces all three with a `tracks` table.
- `Dockerfile` does `COPY package.json package-lock.json* ./` + `npm install`, but the repo ships only `pnpm-lock.yaml`. **Docker builds ignore the lockfile entirely and resolve fresh**, so prod dependency versions can drift from local. Left as-is deliberately; fixing it changes deploy behavior.
- **Dependencies are well behind**: Next 15.5.2 (16 is out), `cashfree-pg` 5 (6 is out), `nodemailer` 7 (9 is out), TypeScript 5 (7 is out). Deliberately not upgraded during the 2026 rework — bumping the payment SDK while rewriting checkout makes failures unattributable.

## Deployment

`Dockerfile` (node:18-alpine) + `docker-compose.yaml` with `env_file: .env`, deployed on Coolify. The healthcheck curls the **public production URL**, not `localhost` — a container will report healthy off another instance's response, and unhealthy if DNS or the proxy is down even when the app is fine.
