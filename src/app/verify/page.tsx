"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
// Type-only import: html5-qrcode is loaded lazily so it never lands in the
// initial bundle for a screen that spends most of its life showing one ticket.
import type { Html5QrcodeScanner, QrcodeSuccessCallback } from "html5-qrcode"
import AdminGate from "@/components/admin/AdminGate"
import BackToAdmin from "@/components/admin/BackToAdmin"
import {
  enqueueOutbox,
  applyBatchResults,
  parseOutbox,
  serializeOutbox,
  pushOutboxBatch,
  type OutboxEntry,
} from "@/lib/verify/outbox"
import {
  parseRoster,
  serializeRoster,
  findTicket,
  upsertTicket,
  applyAttendance,
  overlayPending,
  type CachedRoster,
  type RosterTicket,
} from "@/lib/verify/roster"

// ─────────────────────────────────────────────────────────────────────────────
// The door scanner.
//
// Used one-handed, on a phone, in a queue — in a building whose Wi-Fi drops
// without warning. Every control is a full-width target, the verdict is a
// colour you can read at arm's length, and nothing important is behind a
// scroll.
//
// Offline model, in three pieces:
//   · ROSTER — while online, every live 2026 registration is downloaded once
//     (GET /api/verify/roster) and cached on-device. With no network a scan
//     still resolves to a name, a verdict and its day checkboxes.
//   · OUTBOX — every attendance mark is written locally and queued. A save
//     never waits on a request; the UI says "saved on device" and the queue
//     drains in batches to POST /api/verify/batch whenever the network
//     returns. localStorage persists both, so a phone reload loses nothing.
//   · MERGE SAFETY — the server merges attendance with jsonb `||`, per date
//     key, last write wins. The outbox coalesces exactly the same way, so a
//     queued mark replays byte-identically whether it flushes alone or fused
//     with ten others.
//
// Attendance is per DATE, not per array slot: the checkboxes are exactly the
// days this registration bought. 2025 tickets still resolve online, and are
// read-only; offline they are not in the roster, which says so honestly.
// ─────────────────────────────────────────────────────────────────────────────

const LS_ROSTER = "verify-roster"
const LS_OUTBOX = "verify-outbox"

const PAID_STATUSES = ["success", "comped"]

/** Single-request timeouts. A hanging request on dead Wi-Fi must read as
 *  "offline" in seconds, not after the platform's minutes-long timeout. */
const LOOKUP_TIMEOUT_MS = 8000
const ROSTER_TIMEOUT_MS = 20000
/** Background cadence while there is something to flush. */
const FLUSH_INTERVAL_MS = 30000
/** Re-download the roster when the cached copy is older than this. */
const ROSTER_MAX_AGE_MS = 5 * 60_000
/** How often the staleness check looks at the clock. */
const MAINTENANCE_INTERVAL_MS = 60000

const CARD = "w-full bg-panel-raised rounded-2xl border border-hairline"

/** Full-width primary. One per screen, and always the thing to do next. */
const PRIMARY =
  "w-full min-h-14 rounded-xl bg-accent px-5 text-lg font-bold text-black " +
  "transition-[transform,box-shadow] duration-200 ease-out hover:shadow-lg hover:shadow-accent/30 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.99] " +
  // Inert rather than a dimmed accent: a 40%-opacity purple slab still read as
  // the loudest control on the screen, next to the button you actually want.
  "disabled:bg-white/[0.07] disabled:text-gray-500 disabled:shadow-none disabled:active:scale-100"

const SECONDARY =
  "w-full min-h-14 rounded-xl border border-white/20 bg-white/5 px-5 text-lg font-semibold text-white " +
  "transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-accent-soft active:bg-white/15"

// --- Types -------------------------------------------------------------------

interface TicketDay {
  key: string
  label: string
  present: boolean
}

interface TicketView {
  edition: 2025 | 2026
  readOnly: boolean
  name: string
  orderId: string
  course: string | null
  year: string | null
  department: string | null
  description: string
  sku: string | null
  paymentStatus: string | null
  qrCodeUrl: string | null
  days: TicketDay[]
}

/** A roster entry, as the ticket panel renders it. Pending outbox marks win
 *  over cached values — they are the volunteer's latest intent. */
function viewFromRosterTicket(t: RosterTicket, patch?: Record<string, boolean>): TicketView {
  return {
    edition: 2026,
    readOnly: false,
    name: t.name,
    orderId: t.orderId,
    course: t.course,
    year: t.year,
    department: t.department,
    description: t.description,
    sku: t.sku,
    paymentStatus: t.paymentStatus,
    qrCodeUrl: null,
    days: overlayPending(t.days, patch),
  }
}

// --- fetch helper -------------------------------------------------------------

/** fetch + JSON with a hard timeout, so dead Wi-Fi reads as an error fast. */
async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ res: Response; data: unknown }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    const data = await res.json().catch(() => null)
    return { res, data }
  } finally {
    clearTimeout(timer)
  }
}

// --- Icons -------------------------------------------------------------------
// The verdict is never carried by colour alone: each one pairs its hue with a
// mark and with a word, so it survives colourblindness and direct sunlight.

const TickMark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-8 w-8" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.5l5 5 10-11" />
  </svg>
)

const CrossMark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-8 w-8" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 7l10 10M17 7L7 17" />
  </svg>
)

const ArchiveMark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-8 w-8" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 7.5h17v3h-17zM5 10.5v9h14v-9M9.75 14h4.5" />
  </svg>
)

const QueryMark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="h-8 w-8" aria-hidden="true">
    <circle cx="12" cy="12" r="8.75" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.6 9.6a2.5 2.5 0 114.15 2.1c-.9.7-1.75 1.1-1.75 2.2M12 16.6v.01" />
  </svg>
)

const WifiOffMark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-8 w-8" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5l18 18M8.5 9.4A9.5 9.5 0 015 11.5M12 13.5a4.5 4.5 0 013.4 1.6M15.5 9.2a9.5 9.5 0 013.5 2.3M12 17.6v.01" />
  </svg>
)

// --- QR Code Scanner ---------------------------------------------------------

const QrScanner = ({
  onScanSuccess,
  onStop,
}: {
  onScanSuccess: QrcodeSuccessCallback
  onStop: () => void
}) => {
  useEffect(() => {
    let scanner: Html5QrcodeScanner | null = null

    import("html5-qrcode")
      .then(({ Html5QrcodeScanner }) => {
        if (!document.getElementById("reader")) return
        scanner = new Html5QrcodeScanner(
          "reader",
          {
            fps: 12,
            qrbox: { width: 280, height: 280 },
            rememberLastUsedCamera: true,
            aspectRatio: 1.0,
          },
          false,
        )
        scanner.render(onScanSuccess, () => {
          // Fires on every frame without a QR in it. Nothing to report.
        })
      })
      .catch((err: unknown) => {
        console.error("Failed to load Html5QrcodeScanner", err)
      })

    return () => {
      if (scanner) {
        scanner.clear().catch((error: unknown) => console.error("Failed to clear scanner.", error))
      }
    }
  }, [onScanSuccess])

  return (
    <div className={`${CARD} p-4 sm:p-6`}>
      <h2 className="text-lg font-semibold text-accent-soft mb-1 text-center">Scan ticket</h2>
      <p className="text-center text-gray-300 text-sm mb-4">Align the QR inside the square.</p>
      <div
        id="reader"
        className="w-full bg-white/5 rounded-xl overflow-hidden border border-hairline"
        aria-label="QR code scanner"
      />
      <button onClick={onStop} className={`${SECONDARY} mt-5`}>
        Cancel
      </button>

      <style jsx global>{`
        #reader {
          padding: 10px;
        }
        #reader button,
        #reader a,
        #reader select {
          font-size: 15px;
          border-radius: 12px !important;
          padding: 12px 14px !important;
          min-height: 48px;
          min-width: 48px;
          line-height: 1;
          color: #fff !important;
          background: rgba(255, 255, 255, 0.06) !important;
          border: 1px solid rgba(255, 255, 255, 0.15) !important;
          display: inline-flex !important;
          align-items: center;
          gap: 8px;
          text-decoration: none !important;
          cursor: pointer;
        }
        #reader button:hover,
        #reader a:hover {
          background: color-mix(in srgb, var(--color-accent) 12%, transparent) !important;
          border-color: color-mix(in srgb, var(--color-accent) 45%, transparent) !important;
        }
        #reader .html5-qrcode-anchor-scan-type-change {
          margin-top: 8px !important;
          margin-right: 8px !important;
        }
        #reader select {
          width: 100% !important;
        }
        #reader__dashboard_section_csr,
        #reader__dashboard_section {
          gap: 12px;
        }
      `}</style>
    </div>
  )
}

// --- Verdict banner ----------------------------------------------------------
// The one thing that must be readable at arm's length in a queue.

/** Mark + word + hue, at the size this has to be read from. */
const VerdictBanner = ({
  surface,
  ink,
  mark,
  headline,
  detail,
}: {
  surface: string
  ink: string
  mark: React.ReactNode
  headline: string
  detail?: string
}) => (
  <div
    role="status"
    className={`flex items-center gap-4 rounded-xl border px-4 py-5 ${surface} ${ink}`}
  >
    <span className="shrink-0" aria-hidden="true">
      {mark}
    </span>
    <span className="min-w-0 text-left">
      <span className="block text-2xl leading-none font-extrabold tracking-wide">{headline}</span>
      {detail && <span className="mt-1.5 block text-sm opacity-80">{detail}</span>}
    </span>
  </div>
)

const Verdict = ({ ticket, fromCache }: { ticket: TicketView; fromCache: boolean }) => {
  // Archived 2025 tickets are a RECORD, not a rejection. Slate rather than amber:
  // amber reads as a warning, and a volunteer was left unable to tell whether the
  // screen was refusing someone. No paid/unpaid verdict is computed here — the
  // archive is looked up read-only and that decision is not this screen's to make.
  if (ticket.edition === 2025) {
    return (
      <VerdictBanner
        surface="bg-slate-400/10 border-slate-300/40"
        ink="text-slate-200"
        mark={<ArchiveMark />}
        headline="2025 REGISTRATION"
        detail="Archived ticket · read-only"
      />
    )
  }

  const paid = PAID_STATUSES.includes(ticket.paymentStatus ?? "")
  if (!paid) {
    return (
      <VerdictBanner
        surface="bg-red-500/20 border-red-400/60"
        ink="text-red-300"
        mark={<CrossMark />}
        headline="NOT PAID"
        detail={`Payment status: ${ticket.paymentStatus ?? "unknown"} · do not admit${fromCache ? " · offline data" : ""}`}
      />
    )
  }

  return (
    <VerdictBanner
      surface="bg-green-500/15 border-green-400/50"
      ink="text-green-300"
      mark={<TickMark />}
      headline="VALID TICKET"
      detail={
        ticket.paymentStatus === "comped"
          ? "Comped registration"
          : fromCache
            ? "Verified from the offline roster"
            : undefined
      }
    />
  )
}

// --- Sync chip ---------------------------------------------------------------
// Always visible, so a volunteer never has to wonder whether the marks on this
// device have reached the server.

const SyncChip = ({
  online,
  pending,
  syncing,
  onFlush,
}: {
  online: boolean
  pending: number
  syncing: boolean
  onFlush: () => void
}) => {
  const state = !online
    ? { cls: "border-red-400/50 bg-red-500/15 text-red-300", label: "Offline" }
    : syncing
      ? { cls: "border-amber-400/50 bg-amber-500/15 text-amber-300", label: "Syncing…" }
      : pending > 0
        ? { cls: "border-amber-400/50 bg-amber-500/15 text-amber-300", label: `${pending} queued` }
        : { cls: "border-green-400/50 bg-green-500/15 text-green-300", label: "Synced" }

  const clickable = online && pending > 0 && !syncing
  const content = (
    <span
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-3.5 text-sm font-semibold transition-colors ${state.cls} ${
        clickable ? "cursor-pointer hover:brightness-125 active:brightness-150" : ""
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${
          !online
            ? "bg-red-400"
            : pending > 0 || syncing
              ? "bg-amber-400 animate-pulse motion-reduce:animate-none"
              : "bg-green-400"
        }`}
      />
      {state.label}
    </span>
  )
  return clickable ? (
    <button type="button" onClick={onFlush} title="Tap to sync now" aria-label={`Sync now, ${pending} pending`}>
      {content}
    </button>
  ) : (
    <div role="status">{content}</div>
  )
}

// --- Ticket + attendance -----------------------------------------------------

const TicketPanel = ({
  orderId,
  creds,
  ready,
  pendingForOrder,
  resolveOffline,
  onSeen,
  onSavedPatch,
  onScanNext,
}: {
  orderId: string
  creds: string
  /** Parent has finished restoring persisted state — lookups may begin. */
  ready: boolean
  /** This ticket has marks queued on this device, not yet on the server. */
  pendingForOrder: boolean
  /** Offline resolution from the parent's roster + outbox. Null when the
   *  ticket is not cached. Stable callback reading live refs. */
  resolveOffline: (orderId: string) => TicketView | null
  onSeen: (ticket: TicketView) => void
  onSavedPatch: (orderId: string, patch: Record<string, boolean>) => void
  onScanNext: () => void
}) => {
  const [ticket, setTicket] = useState<TicketView | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [days, setDays] = useState<TicketDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [offlineMiss, setOfflineMiss] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    setLoading(true)
    setError("")
    setOfflineMiss(false)
    setSaved(false)

    const run = async () => {
      // Online path: the server is the source of truth. Offline (or any
      // transport failure, including our own timeout): resolve from the
      // roster so the door keeps moving.
      try {
        const { res, data } = await fetchJson(
          "/api/verify",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: creds },
            body: JSON.stringify({ orderId }),
          },
          LOOKUP_TIMEOUT_MS,
        )
        if (cancelled) return
        const body = data as { success?: boolean; message?: string; details?: TicketView } | null
        if (!res.ok || !body?.success) {
          throw new Error(body?.message || "Ticket not found.")
        }
        const details = body.details
        if (!details) throw new Error("Ticket not found.")
        setTicket(details)
        setDays(details.days ?? [])
        setFromCache(false)
        onSeen(details)
        return
      } catch {
        // Fall through to the roster.
      }

      const cached = resolveOffline(orderId)
      if (cancelled) return
      if (cached) {
        setTicket(cached)
        setDays(cached.days)
        setFromCache(true)
        return
      }
      const wasOnline = typeof navigator !== "undefined" ? navigator.onLine : true
      setOfflineMiss(!wasOnline)
      setError(wasOnline ? "Ticket not found." : "You are offline and this ticket is not in the downloaded roster.")
    }
    // The spinner clears when the lookup settles — success, cache hit, or miss.
    // Forgetting this once meant a permanent "Looking up ticket…" spinner.
    run().finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [orderId, creds, ready, resolveOffline, onSeen])

  const dirty = useMemo(
    () => !!ticket && days.some((d, i) => d.present !== (ticket.days[i]?.present ?? false)),
    [days, ticket],
  )

  const toggle = (key: string) => {
    setSaved(false)
    setDays((prev) => prev.map((d) => (d.key === key ? { ...d, present: !d.present } : d)))
  }

  const save = () => {
    if (!ticket || ticket.readOnly) return
    // Local first, always. The patch is applied on-device and queued; when the
    // network is up the flush carries it out within the same second, so the
    // online path costs exactly one request — it just never blocks the
    // volunteer on it.
    const patch = Object.fromEntries(days.map((d) => [d.key, d.present]))
    setTicket({ ...ticket, days })
    onSavedPatch(orderId, patch)
    setSaved(true)
  }

  if (loading) {
    return (
      <div className={`${CARD} p-10 flex flex-col items-center gap-4`}>
        <span className="block h-10 w-10 rounded-full border-[3px] border-hairline border-t-accent animate-spin [animation-duration:0.9s] motion-reduce:animate-none" />
        <p className="text-gray-300">Looking up ticket…</p>
      </div>
    )
  }

  if (error && !ticket) {
    return (
      <div className={`${CARD} p-4 sm:p-6 space-y-5`}>
        <VerdictBanner
          surface={offlineMiss ? "bg-amber-500/15 border-amber-400/50" : "bg-red-500/20 border-red-400/60"}
          ink={offlineMiss ? "text-amber-200" : "text-red-300"}
          mark={offlineMiss ? <WifiOffMark /> : <QueryMark />}
          headline={offlineMiss ? "OFFLINE" : "NOT FOUND"}
          detail={
            offlineMiss
              ? `${error} Reconnect, refresh the roster from the home screen, and rescan. 2025 archive tickets also need a connection.`
              : error
          }
        />
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">Scanned code</p>
          <p className="mt-1 font-mono text-sm text-gray-300 break-all">{orderId}</p>
        </div>
      </div>
    )
  }

  if (!ticket) return null

  const marked = days.filter((d) => d.present).length

  return (
    <div className={`${CARD} p-4 sm:p-6 space-y-5`}>
      <Verdict ticket={ticket} fromCache={fromCache} />

      <div>
        <p className="text-2xl font-bold text-white leading-tight break-words">{ticket.name}</p>
        <p className="mt-1.5 font-medium text-accent-soft">{ticket.description}</p>
        <p className="mt-1.5 text-sm text-gray-300">
          {[ticket.year, ticket.course, ticket.department].filter(Boolean).join(" · ") || "—"}
        </p>
        {/* Read aloud when something needs sorting out, so it is not the faintest
            thing on the screen. */}
        <p className="mt-3 font-mono text-sm tracking-wide text-gray-300 break-all">{ticket.orderId}</p>
      </div>

      <div className="border-t border-hairline pt-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">
            {ticket.readOnly ? "Attendance record" : "Mark attendance"}
          </h2>
          {days.length > 0 && (
            <span className="shrink-0 text-sm font-semibold text-gray-300">
              {marked}/{days.length} present
            </span>
          )}
        </div>
        <p className="text-sm text-gray-400 mb-3">
          {ticket.readOnly
            ? "Archived 2025 record. Attendance cannot be changed."
            : `${ticket.days.length} ${ticket.days.length === 1 ? "day" : "days"} on this ticket.`}
        </p>

        <div className="space-y-3">
          {days.length === 0 && (
            <p className="text-sm text-gray-400">No attendance days on this registration.</p>
          )}
          {days.map((day) => (
            <label
              key={day.key}
              className={`flex items-center gap-4 min-h-[4.5rem] px-4 rounded-xl border transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-soft ${
                ticket.readOnly
                  ? "border-hairline bg-white/[0.03] cursor-not-allowed"
                  : day.present
                    ? "border-green-400/60 bg-green-500/15 cursor-pointer"
                    : "border-hairline bg-white/5 cursor-pointer active:bg-white/10"
              }`}
            >
              {/* The native control carries the semantics; the box beside it is
                  what a volunteer actually sees and hits. The whole 72px row is
                  the target either way. */}
              <input
                type="checkbox"
                checked={day.present}
                disabled={ticket.readOnly}
                onChange={() => toggle(day.key)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 transition-colors ${
                  day.present
                    ? "border-green-400 bg-green-400 text-black"
                    : "border-hairline bg-white/5 text-transparent"
                } ${ticket.readOnly ? "opacity-60" : ""}`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.5l5 5 10-11" />
                </svg>
              </span>
              <span
                className={`flex-1 text-lg font-semibold ${ticket.readOnly ? "text-gray-300" : "text-white"}`}
              >
                {day.label}
              </span>
              <span
                className={`text-sm font-bold uppercase tracking-wide ${
                  day.present ? "text-green-300" : "text-gray-400"
                }`}
              >
                {day.present ? "Present" : "Absent"}
              </span>
            </label>
          ))}
        </div>

        {error && ticket && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-300"
          >
            {error}
          </p>
        )}
        {saved && !dirty && (
          <p
            className={`mt-4 flex items-center justify-center gap-2 rounded-lg border text-center font-semibold py-3 ${
              pendingForOrder
                ? "border-amber-400/40 bg-amber-500/15 text-amber-300"
                : "border-green-400/40 bg-green-500/15 text-green-300"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-5 w-5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.5l5 5 10-11" />
            </svg>
            {pendingForOrder ? "Saved on device — syncing" : "Attendance saved"}
          </p>
        )}

        {!ticket.readOnly && (
          <button onClick={save} disabled={!dirty} className={`${PRIMARY} mt-4`}>
            {dirty ? "Save attendance" : "No changes"}
          </button>
        )}
      </div>

      {/* Secondary whenever Save is on screen, primary when it is the only button.
          Deliberately not swapped by `dirty`: a control that changes colour under
          a volunteer's thumb is how tickets get mis-tapped in a queue. */}
      <button onClick={onScanNext} className={ticket.readOnly ? PRIMARY : SECONDARY}>
        Scan next ticket
      </button>
    </div>
  )
}

// --- Roster bar --------------------------------------------------------------

function rosterAgeLabel(fetchedAt: string): string {
  const ms = Date.now() - new Date(fetchedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return "just now"
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return "just now"
  if (mins === 1) return "1 min ago"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  return hours === 1 ? "1 hr ago" : `${hours} hrs ago`
}

const RosterBar = ({
  roster,
  loading,
  online,
  onRefresh,
}: {
  roster: CachedRoster | null
  loading: boolean
  online: boolean
  onRefresh: () => void
}) => (
  <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-white/[0.03] px-4 py-3 text-left">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-white">
        {roster
          ? `Offline roster · ${roster.tickets.length} ${roster.tickets.length === 1 ? "ticket" : "tickets"}`
          : "Offline roster not downloaded"}
      </p>
      <p className="mt-0.5 text-xs text-gray-400">
        {roster
          ? `Downloaded ${rosterAgeLabel(roster.fetchedAt)}`
          : online
            ? "Tap Refresh while the network is up."
            : "Needs a connection."}
      </p>
    </div>
    <button
      onClick={onRefresh}
      disabled={loading || !online}
      className="shrink-0 min-h-11 px-4 text-sm font-semibold rounded-lg border border-hairline bg-white/[0.05] text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft disabled:opacity-40"
    >
      {loading ? "Fetching…" : "Refresh"}
    </button>
  </div>
)

// --- Screen ------------------------------------------------------------------

/** Ticket QRs encode a /verify?orderId=… URL. Accept a bare id too, in case a
 *  reprinted or hand-typed code arrives without the URL around it. */
function orderIdFromScan(text: string): string | null {
  try {
    const id = new URL(text).searchParams.get("orderId")
    if (id) return id
  } catch {
    // Not a URL. Fall through.
  }
  const bare = text.trim()
  return /^[A-Za-z0-9_-]{4,256}$/.test(bare) ? bare : null
}

const VerifyScreen = ({ creds, logout }: { creds: string; logout: () => void }) => {
  const [orderId, setOrderId] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState("")
  const [manualId, setManualId] = useState("")

  const [roster, setRoster] = useState<CachedRoster | null>(null)
  const [outbox, setOutbox] = useState<OutboxEntry[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [online, setOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterError, setRosterError] = useState("")
  const [discarded, setDiscarded] = useState<string[]>([])

  // The refs mirror the state so the flush loop and offline lookups can read
  // the current queue/roster without re-running on every change. They are the
  // only readers/writers of persisted data; setState is for rendering alone.
  const rosterRef = useRef<CachedRoster | null>(null)
  const outboxRef = useRef<OutboxEntry[]>([])
  const flushingRef = useRef(false)
  const rosterLoadingRef = useRef(false)

  // One-time restoration of persisted state, before any child lookups run.
  useEffect(() => {
    setOnline(navigator.onLine)
    const r = parseRoster(window.localStorage.getItem(LS_ROSTER))
    const o = parseOutbox(window.localStorage.getItem(LS_OUTBOX))
    rosterRef.current = r
    outboxRef.current = o
    setRoster(r)
    setOutbox(o)
    setHydrated(true)
  }, [])

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener("online", up)
    window.addEventListener("offline", down)
    return () => {
      window.removeEventListener("online", up)
      window.removeEventListener("offline", down)
    }
  }, [])

  // Warm the scanner chunk while the volunteer reads the home screen, so the
  // first "Start scanning" opens the camera instead of a download spinner on
  // college Wi-Fi.
  useEffect(() => {
    let idleId: number | null = null
    const start = () => {
      import("html5-qrcode").catch(() => {
        /* The scanner card shows its own error if the chunk truly fails. */
      })
    }
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(start, { timeout: 4000 })
    } else {
      idleId = window.setTimeout(start, 1500)
    }
    return () => {
      if (idleId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId)
      } else if (idleId !== null) {
        window.clearTimeout(idleId)
      }
    }
  }, [])

  const persistOutbox = useCallback((entries: OutboxEntry[]) => {
    outboxRef.current = entries
    setOutbox(entries)
    try {
      window.localStorage.setItem(LS_OUTBOX, serializeOutbox(entries))
    } catch {
      // A quota error must never take a save down with it; the in-memory
      // queue still flushes this session.
    }
  }, [])

  const persistRoster = useCallback((next: CachedRoster | null) => {
    rosterRef.current = next
    setRoster(next)
    try {
      if (next) window.localStorage.setItem(LS_ROSTER, serializeRoster(next))
      else window.localStorage.removeItem(LS_ROSTER)
    } catch {
      // As above: a full quota degrades the next cold start, not this session.
    }
  }, [])

  const refreshRoster = useCallback(
    async (silent: boolean) => {
      if (rosterLoadingRef.current) return
      rosterLoadingRef.current = true
      setRosterLoading(true)
      if (!silent) setRosterError("")
      try {
        const { res, data } = await fetchJson(
          "/api/verify/roster",
          { headers: { Authorization: creds } },
          ROSTER_TIMEOUT_MS,
        )
        const body = data as { success?: boolean; fetchedAt?: string; tickets?: unknown; message?: string } | null
        if (!res.ok || !body?.success || typeof body.fetchedAt !== "string") {
          throw new Error(body?.message || "Could not download the roster.")
        }
        const parsed = parseRoster(JSON.stringify({ fetchedAt: body.fetchedAt, tickets: body.tickets }))
        if (!parsed) throw new Error("Roster payload was invalid.")
        persistRoster(parsed)
        setRosterError("")
      } catch (err: unknown) {
        if (!silent) {
          setRosterError(err instanceof Error ? err.message : "Could not download the roster.")
        }
      } finally {
        rosterLoadingRef.current = false
        setRosterLoading(false)
      }
    },
    [creds, persistRoster],
  )

  const flush = useCallback(async () => {
    if (flushingRef.current) return
    if (typeof navigator !== "undefined" && !navigator.onLine) return
    flushingRef.current = true
    setSyncing(true)
    try {
      // Drain until the queue is empty, the transport fails, or a full pass
      // makes no progress — whichever comes first.
      for (let pass = 0; pass < 20; pass++) {
        const current = outboxRef.current
        if (current.length === 0) break
        const { results, reachedServer } = await pushOutboxBatch(current, async (url, body) => {
          const { res, data } = await fetchJson(
            url,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: creds },
              body,
            },
            LOOKUP_TIMEOUT_MS,
          )
          return { ok: res.ok, status: res.status, json: async () => data }
        })
        if (!reachedServer || results.length === 0) break

        const dead: string[] = []
        for (const r of results) {
          if (!r.ok && (r.error === "not_found" || r.error === "invalid")) dead.push(r.orderId)
        }
        if (dead.length > 0) {
          const note = `${dead.length === 1 ? "1 mark" : `${dead.length} marks`} discarded — ticket no longer in the live table`
          setDiscarded((prev) => [...prev.slice(-4), note])
        }

        const { entries } = applyBatchResults(current, results)
        persistOutbox(entries)

        // Server echo for acked entries refreshes the cached copy with what is
        // actually stored — including marks another door made meanwhile.
        for (const r of results) {
          if (!r.ok || !r.attendance) continue
          if (!rosterRef.current || !findTicket(rosterRef.current, r.orderId)) continue
          persistRoster(applyAttendance(rosterRef.current, r.orderId, r.attendance))
        }
        if (entries.length === current.length) break
      }
    } finally {
      flushingRef.current = false
      setSyncing(false)
    }
  }, [creds, persistOutbox, persistRoster])

  // Drain the queue whenever the network returns and on a timer while anything
  // is queued. The mount pass also covers marks left queued by a previous
  // session on this device.
  useEffect(() => {
    if (!hydrated) return
    if (!online || outbox.length === 0) return
    void flush()
    const timer = window.setInterval(() => void flush(), FLUSH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [hydrated, online, outbox.length, flush])

  // Start-of-day prep: fetch the roster right after login, then keep it fresh
  // in the background so a volunteer never scans against a stale copy while
  // online. Silent — failures only surface on the manual Refresh.
  useEffect(() => {
    if (!hydrated) return
    const stale = () => {
      const r = rosterRef.current
      return !r || Date.now() - new Date(r.fetchedAt).getTime() > ROSTER_MAX_AGE_MS
    }
    if (online && stale()) void refreshRoster(true)
    const timer = window.setInterval(() => {
      if (navigator.onLine && stale()) void refreshRoster(true)
    }, MAINTENANCE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [hydrated, online, refreshRoster])

  const onSavedPatch = useCallback(
    (id: string, patch: Record<string, boolean>) => {
      persistOutbox(enqueueOutbox(outboxRef.current, id, patch, Date.now()))
      if (rosterRef.current) persistRoster(applyAttendance(rosterRef.current, id, patch))
      void flush()
    },
    [flush, persistOutbox, persistRoster],
  )

  const onSeen = useCallback(
    (ticket: TicketView) => {
      if (ticket.edition !== 2026 || !rosterRef.current) return
      // Server truth replaces the cached copy; pending marks are overlaid at
      // render time instead of being baked into the cache.
      persistRoster(upsertTicket(rosterRef.current, ticket))
    },
    [persistRoster],
  )

  const pendingForOrder = useMemo(
    () => (orderId ? outbox.some((e) => e.orderId === orderId) : false),
    [outbox, orderId],
  )

  /** Offline lookup: roster entry overlaid with the still-queued marks for
   *  that ticket. Reads refs, so the callback stays stable. */
  const resolveOffline = useCallback((id: string): TicketView | null => {
    const cached = findTicket(rosterRef.current, id)
    if (!cached) return null
    const pendingPatch = outboxRef.current.find((e) => e.orderId === id)?.patch
    return viewFromRosterTicket(cached, pendingPatch)
  }, [])

  // A 2026 or 2025 QR opens this page directly with ?orderId=…
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("orderId")
    if (id) setOrderId(id)
  }, [])

  const openTicket = useCallback((id: string) => {
    window.history.pushState({}, "", `/verify?orderId=${encodeURIComponent(id)}`)
    setOrderId(id)
  }, [])

  const onScanSuccess = useCallback<QrcodeSuccessCallback>(
    (decodedText) => {
      const id = orderIdFromScan(decodedText)
      if (!id) {
        setScanError("That is not a PFE ticket QR code.")
        return
      }
      setScanError("")
      setScanning(false)
      openTicket(id)
    },
    [openTicket],
  )

  const scanNext = () => {
    window.history.pushState({}, "", "/verify")
    setOrderId(null)
    setScanError("")
    setScanning(true)
  }

  const logoutAfterFlush = async () => {
    // Best-effort drain before leaving — but the queue itself stays on the
    // device: it is device-scoped, not session-scoped, and the next login
    // picks it up. Clearing here is how marks get lost.
    await flush()
    window.history.pushState({}, "", "/verify")
    setOrderId(null)
    logout()
  }

  const clearCachedData = () => {
    // Only reachable with an empty queue (the button disables itself
    // otherwise), so this cannot discard unsynced marks.
    persistOutbox([])
    persistRoster(null)
    setDiscarded([])
  }

  const pending = outbox.length

  return (
    <main className="min-h-screen bg-panel text-white px-4 py-4 font-sans">
      <div className="w-full max-w-md mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h1 className="text-xl font-bold text-accent-soft">PFE Door Check</h1>
          <div className="flex items-center gap-2">
            <SyncChip online={online} pending={pending} syncing={syncing} onFlush={() => void flush()} />
            <BackToAdmin />
            <button
              onClick={() => void logoutAfterFlush()}
              className="min-h-11 px-4 text-sm text-gray-300 hover:text-white bg-panel-raised rounded-lg border border-hairline focus:outline-none focus:ring-2 focus:ring-accent-soft/60 transition"
            >
              Log out
            </button>
          </div>
        </div>

        {discarded.length > 0 && (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-amber-400/40 bg-amber-500/15 px-4 py-3 text-sm text-amber-200"
          >
            {discarded[discarded.length - 1]}
          </p>
        )}

        {scanError && (
          <p
            role="alert"
            className="mb-4 rounded-lg bg-red-500/20 border border-red-400/50 text-red-300 text-center font-semibold py-3 px-4"
          >
            {scanError}
          </p>
        )}

        {scanning ? (
          <QrScanner onScanSuccess={onScanSuccess} onStop={() => setScanning(false)} />
        ) : orderId ? (
          <TicketPanel
            orderId={orderId}
            creds={creds}
            ready={hydrated}
            pendingForOrder={pendingForOrder}
            resolveOffline={resolveOffline}
            onSeen={onSeen}
            onSavedPatch={onSavedPatch}
            onScanNext={scanNext}
          />
        ) : (
          <div className={`${CARD} p-6 sm:p-8 text-center space-y-5`}>
            <span
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-accent/35 bg-accent/10 text-accent"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-8 w-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V5.5A1.5 1.5 0 015.5 4H9M15 4h3.5A1.5 1.5 0 0120 5.5V9M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15M9 20H5.5A1.5 1.5 0 014 18.5V15" />
                <path strokeLinecap="round" d="M4 12h16" />
              </svg>
            </span>
            <div>
              <h2 className="text-2xl font-bold text-white">Ready to verify</h2>
              <p className="mt-2 text-gray-300">Scan a ticket QR to check it in.</p>
            </div>
            <RosterBar
              roster={roster}
              loading={rosterLoading}
              online={online}
              onRefresh={() => void refreshRoster(false)}
            />
            {rosterError && (
              <p role="alert" className="text-sm text-red-300 text-left -mt-3">
                {rosterError}
              </p>
            )}
            <button
              onClick={() => {
                setScanError("")
                setScanning(true)
              }}
              className={PRIMARY}
            >
              Start scanning
            </button>

            {/* Camera-dead or cracked-QR fallback: the same orderId parser the
                scanner uses, so a pasted ticket URL works too. */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const id = orderIdFromScan(manualId.trim())
                if (!id) {
                  setScanError("That does not look like a PFE Order ID.")
                  return
                }
                setScanError("")
                setManualId("")
                openTicket(id)
              }}
              className="space-y-2"
            >
              <label htmlFor="manual-order" className="block text-xs font-medium uppercase tracking-[0.16em] text-gray-400">
                Or enter the Order ID
              </label>
              <div className="flex gap-2">
                <input
                  id="manual-order"
                  type="text"
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  placeholder="PFE-XXXXXXXXXX"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="min-w-0 flex-1 bg-white/5 border border-hairline rounded-xl px-4 text-base font-mono tracking-wide text-white placeholder-gray-600 outline-none transition-[border-color,box-shadow] hover:border-hairline/80 focus:border-accent/60 focus:ring-2 focus:ring-accent/25"
                />
                <button
                  type="submit"
                  disabled={manualId.trim().length === 0}
                  className="shrink-0 min-h-14 px-5 rounded-xl border border-white/20 bg-white/5 text-lg font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft disabled:opacity-40"
                >
                  Open
                </button>
              </div>
            </form>
            <button onClick={clearCachedData} disabled={pending > 0} className={SECONDARY}>
              {pending > 0 ? `Clear cached data (${pending} pending)` : "Clear cached data"}
            </button>
            <p className="text-xs text-gray-500">
              Attendance marked offline is stored on this device and syncs automatically when the
              network returns.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}

export default function VerifyPage() {
  return (
    <AdminGate title="Door Check" role="staff">
      {({ creds, logout }) => <VerifyScreen creds={creds} logout={logout} />}
    </AdminGate>
  )
}
