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

**After pulling a schema change, run `pnpm exec drizzle-kit migrate`.** `0006` creates and seeds `settings`; `0007` archives 2025 into `pferegistration_2025`, clears the live table and adds the 2026 columns; `0008` drops `domain` and seeds the seven tracks; `0010` adds `field_labels` and appends "Sixth Year" to the existing row (a changed column DEFAULT does not touch rows that already exist, and `settings` is a singleton that always does). Without them `/admin` errors and the home page falls back to "registration closed".

**`drizzle-kit generate` cannot run non-interactively here.** When a table has both added and dropped columns in one diff it prompts "created or renamed?", and it reads raw keypresses — piping input hangs forever. Split such a change into two migrations (adds first, drops second), as `0007`/`0008` do.

- Without a real `DATABASE_URL`, `pnpm dev` still boots and static pages render, but every DB-backed route (`/api/*`, `/stats`, `/sync`, `/verify`) 500s, and the home page falls back to "registration closed".

**Local database in one command** — `src/lib/db/index.ts` skips SSL for `localhost`/`127.0.0.1` and for any URL with `?sslmode=disable`, so a plain container works. Remote hosts keep the permissive `rejectUnauthorized: false` they always had.

```bash
docker run -d --name pfe-db -e POSTGRES_PASSWORD=pfe -e POSTGRES_DB=pfe -p 55432:5432 postgres:16-alpine
# DATABASE_URL=postgres://postgres:pfe@localhost:55432/pfe
pnpm exec drizzle-kit migrate
```
- `pnpm lint` is at **zero errors and zero warnings**. Keep it there — a red lint now means you broke something.
- `next.config.ts` sets `eslint.ignoreDuringBuilds: true`, so `pnpm build` will **not** catch lint errors. Run `pnpm lint` separately.
- **`pnpm test`** runs vitest. Coverage is deliberately narrow: 60 cases over `src/lib/pricing/resolvePrice.ts` and nothing else. That function is where a wrong answer charges a real student the wrong amount, and it is pure, so it is exhaustively testable without a database. There is no E2E suite.
- `scripts/mail.ts` and `scripts/qrGen.ts` have no wired-up runner. `ts-node` is a dependency but fails on both (`Unknown file extension ".ts"` — the tsconfig is ESM/bundler-oriented and `qrGen.ts` uses top-level await).
  - **`scripts/mail.ts` is the confirmation-email test harness.** Unlike `src/lib/mail/mailUtil.ts`, it takes an `orderId` and generates the QR itself, so you can preview the real email without going through a payment. Edit the placeholder call on the last line (`sendMail("email", "domain", "name", "orderid")`) and run it. **That call fires at module scope**, so importing this file sends an email as a side effect — never import it from app code.
  - Getting it to actually run needs a runner that handles ESM TypeScript (`npx tsx scripts/mail.ts`); plain `ts-node` will not work with this tsconfig.

## Architecture

Next.js 15 App Router + React 19 + Tailwind v4 (via `@tailwindcss/postcss`; there is no `tailwind.config`) + Drizzle ORM over `node-postgres`. `@/*` maps to `./src/*`.

### Four tables

All in `src/lib/db/schema.ts`.

**`pferegistration`** — one row per registration.
- `orderId` is the unique business key, and it is **opaque**. Never parse it. 2025 encoded the track in its last character and `api/webhook` read it back out; that broke the moment comped orders gained an `-ACM` suffix, and every one of those emails said "Welcome to the undefined track". If you need to know what someone bought, `SELECT` the row.
- `sku` is one of `capstone` / `single` / `bundle`, plus up to two nullable track FKs and a `hasCapstone` boolean.
- `attendance` is `jsonb` **keyed by date** — `{ "2026-09-17": true }`. Not positional: a capstone buyer attends one day and a bundle buyer attends five, so an index means nothing.
- `amountPaid` is integer **paise**, computed server-side. The client never sends a price.
- `emailSentAt` null on a `success` row means someone paid and got no ticket.

**`tracks`** — the seven 2026 tracks. A table rather than JSON on `settings` because capacity is checked under `SELECT … FOR UPDATE`, and you cannot row-lock a JSON key.

**`settings`** — the singleton config row behind `/admin`.
- `fieldOptions` holds the dropdown contents; `fieldLabels` holds the **wording** — one `{label, placeholder, selectPrompt?}` per form field. Its keys are the **column names** (`course`, `department`, …) and are fixed; only what registrants read is editable, so rewording a field needs no migration and no deploy. **If you do rename one, the Google Sheet, `/stats` and the registration list keep using the column names** and will disagree with the form — a "Programme"/"Course" swap was tried and reverted for exactly that reason.
- `selectPrompt` exists only for `course` and `department` — the two fields that render as a dropdown for a known college and as free text once "Other" is picked, so they need two different hints. Everything else needs one.
- `getSettings()` merges stored labels over `DEFAULT_FIELD_LABELS` via `withLabelDefaults()`. Without it a row written before a field existed renders the string "undefined" as that field's label.

**`pferegistration_2025`** — the archive. Read-only; 2025 QR codes still resolve against it via `src/lib/registration/lookupTicket.ts`.

Money is **integer paise** everywhere. Convert only at the Cashfree boundary with `paiseToRupees()`.

### Capacity, and the thing that is easy to get wrong

`src/lib/registration/capacity.ts`. A seat is held by `success`, `comped`, **or a `pending` row younger than `PENDING_HOLD_MINUTES` (30)**.

Both halves matter. Counting only settled rows lets two buyers at capacity−1 both pass the check — their own rows are still `pending` and invisible to each other — and both then pay. Counting `pending` forever is the opposite bug: a closed Cashfree modal fires no webhook at all, so nothing ever releases the seat.

`api/create-order` locks the track rows `FOR UPDATE` inside the same transaction as the insert, and calls Cashfree only **after** the commit so a slow gateway never holds those locks.

### Payment → ticket flow

```
/  RegistrationForm — posts { sku, beginnerTrack, advancedTrack, ... }
   │                  track SLUGS, never ids. No amount.
   ▼
api/create-order
   ├─ settings.registrationOpen false ──► 403 REGISTRATION_CLOSED
   ├─ resolveSelection()  — capstone carries no track, bundle carries both
   ├─ resolvePrice()      — the ONLY place an amount is decided
   ├─ TRANSACTION: lock tracks FOR UPDATE, check seats, insert 'pending'
   └─ amountPaid === 0 ──► completeWithoutPayment()   (Cashfree cannot take ₹0)
      else            ──► Cashfree PGCreateOrder      (after the commit)
                             │
                             ▼
                    api/webhook  — HMAC over `${timestamp}${rawBody}`
                      ├─ already success/comped ──► 200 no-op (Cashfree RETRIES)
                      ├─ paid amount ≠ row.amountPaid ──► 400, no ticket
                      ├─ 'success' + QR + sendTicketEmail()
                      └─ FAILED/USER_DROPPED → 'failure', only if still pending
```

The webhook needs the **raw unparsed body** for signature verification — `getRawBody()` reads the stream manually. Do not add body parsing ahead of it. It is idempotent by design; Cashfree retries on timeout and on any non-2xx.

### Attendance scanning

`/verify` scans the ticket QR with `html5-qrcode`, then POSTs to `api/verify`. Writable dates are derived from the registration's SKU and its tracks' dates — a scanner cannot mark someone present for a day they did not buy. The update merges in Postgres with jsonb `||` rather than read-modify-write, so two volunteers scanning at two doors cannot silently undo each other. Archived 2025 tickets resolve read-only and reject attendance writes with a 409.

### Google Sheets sync

`api/sync-sheet` diffs the live table against the **`PFE2026`** tab, keyed on the `Order ID` column looked up **by header name, not index**, then batch-updates changed rows and appends new ones. The diff logic is a pure function in `src/lib/registration/sheetSync.ts`. `Sheet1` is the frozen 2025 record and is never written to. Triggered manually from `/sync`, and by an external cron — which is why the Dockerfile installs `curl` ("Need this for Sync Job").

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

- **Never read `process.env.NEXT_PUBLIC_*` in server code.** Next inlines those at **build** time even inside route handlers, so `next build` freezes the build machine's value into `.next/server`. `NEXT_PUBLIC_SITE_URL` was read in the webhook, `completeWithoutPayment` and `create-order`; the compiled bundle literally contained `` toDataURL(`http://localhost:3000/verify?orderId=${orderId}`) ``, and setting the variable in Coolify could not change it. The origin now comes from **`SITE_URL`** (no prefix → runtime lookup) via `src/lib/siteUrl.ts`, which throws on a missing or non-absolute value. It throws on purpose: `` `${undefined}/verify?…` `` produces a valid QR image, a normal-looking email and a set `emailSentAt`, so the failure is invisible until someone scans a dead ticket at the door. To check a build: `` grep -o ".\{60\}verify?orderId=" .next/server/chunks/*.js `` must show no literal host. **`SITE_URL` is required in any container deploy** — `.dockerignore` excludes `.env`, so the image builds with `NEXT_PUBLIC_SITE_URL` unset and the fallback compiles to `process.env.SITE_URL || ""`, which is no fallback at all. Set it in Coolify *before* deploying, or every checkout 500s.
- `src/lib/db/index.ts` connects with `ssl: { rejectUnauthorized: false }`.
- **In-memory state that breaks with more than one instance:** the 3-minute per-address email throttle (`lastSentTimes` in `src/lib/mail/mailUtil.ts`). It silently degrades behind a load balancer — two containers hold two different maps and disagree. This is why `getSettings()` and track availability are deliberately uncached; do not "optimise" either into a second copy of this bug.
- **The `/admin` open/close toggle saves itself, immediately, on its own PATCH.** Do not fold it back into the sticky save bar. That bar is tab-scoped, so a toggle routed through it gets dropped on the Tracks tab while still reporting a green "Saved" — the banner reads OPEN, the button reads "Open registration", and the public form keeps taking money.
- The confirmation email is a large inline HTML template literal in `mailUtil.ts`, compiled from `src/lib/mail/mail.mjml`. **`mjml` is not a project dependency** — regenerating means `npx mjml src/lib/mail/mail.mjml` and pasting the result back into the template literal. Keeping the two in sync is manual. Content now comes from `settings.eventConfig`; the template supplies layout only.
- `/sync`, `/stats` still have their own copy-pasted login forms rather than `AdminGate`.
- `Dockerfile` does `COPY package.json package-lock.json* ./` + `npm install`, but the repo ships only `pnpm-lock.yaml`. **Docker builds ignore the lockfile entirely and resolve fresh**, so prod dependency versions can drift from local. Left as-is deliberately; fixing it changes deploy behavior.
- **Dependencies are well behind**: Next 15.5.2 (16 is out), `cashfree-pg` 5 (6 is out), `nodemailer` 7 (9 is out), TypeScript 5 (7 is out). Deliberately not upgraded during the 2026 rework — bumping the payment SDK while rewriting checkout makes failures unattributable.

## Deployment

`Dockerfile` (node:22-alpine) + `docker-compose.yaml` with `env_file: .env`, deployed on Coolify. The healthcheck curls the **public production URL**, not `localhost` — a container will report healthy off another instance's response, and unhealthy if DNS or the proxy is down even when the app is fine.
