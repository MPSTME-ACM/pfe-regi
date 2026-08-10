"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
// Type-only import: html5-qrcode is loaded lazily so it never lands in the
// initial bundle for a screen that spends most of its life showing one ticket.
import type { Html5QrcodeScanner, QrcodeSuccessCallback } from "html5-qrcode"
import AdminGate from "@/components/admin/AdminGate"

// ─────────────────────────────────────────────────────────────────────────────
// The door scanner.
//
// Used one-handed, on a phone, in a queue. Every control is a full-width target,
// the verdict is a colour you can read at arm's length, and nothing important is
// behind a scroll.
//
// Attendance is per DATE, not per array slot: the checkboxes are exactly the days
// this registration bought. 2025 tickets still resolve, and are read-only.
// ─────────────────────────────────────────────────────────────────────────────

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

const PAID_STATUSES = ["success", "comped"]

const CARD = "w-full bg-black/30 backdrop-blur-md rounded-2xl border border-white/10"

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
      <p className="text-center text-gray-400 text-sm mb-4">Align the QR inside the square.</p>
      <div
        id="reader"
        className="w-full bg-white/5 rounded-xl overflow-hidden border border-white/15"
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
          background: rgba(233, 123, 252, 0.12) !important;
          border-color: rgba(233, 123, 252, 0.45) !important;
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

const Verdict = ({ ticket }: { ticket: TicketView }) => {
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
        detail={`Payment status: ${ticket.paymentStatus ?? "unknown"} · do not admit`}
      />
    )
  }

  return (
    <VerdictBanner
      surface="bg-green-500/15 border-green-400/50"
      ink="text-green-300"
      mark={<TickMark />}
      headline="VALID TICKET"
      detail={ticket.paymentStatus === "comped" ? "Comped registration" : undefined}
    />
  )
}

// --- Ticket + attendance -----------------------------------------------------

const TicketPanel = ({
  orderId,
  creds,
  onScanNext,
}: {
  orderId: string
  creds: string
  onScanNext: () => void
}) => {
  const [ticket, setTicket] = useState<TicketView | null>(null)
  const [days, setDays] = useState<TicketDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError("")
    setSaved(false)

    const run = async () => {
      try {
        const res = await fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: creds },
          body: JSON.stringify({ orderId }),
        })
        const data = await res.json()
        if (cancelled) return
        if (!res.ok || !data.success) {
          setError(data.message || "Ticket not found.")
          return
        }
        setTicket(data.details)
        setDays(data.details.days ?? [])
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Network error.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [orderId, creds])

  const dirty = useMemo(
    () => !!ticket && days.some((d, i) => d.present !== (ticket.days[i]?.present ?? false)),
    [days, ticket],
  )

  const toggle = (key: string) => {
    setSaved(false)
    setDays((prev) => prev.map((d) => (d.key === key ? { ...d, present: !d.present } : d)))
  }

  const save = async () => {
    if (!ticket || ticket.readOnly) return
    setSaving(true)
    setError("")
    try {
      const attendance = Object.fromEntries(days.map((d) => [d.key, d.present]))
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: creds },
        body: JSON.stringify({ orderId, attendance }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to save attendance.")
      setTicket(data.details)
      setDays(data.details.days ?? [])
      setSaved(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save attendance.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className={`${CARD} p-10 flex flex-col items-center gap-4`}>
        <span className="block h-10 w-10 rounded-full border-[3px] border-white/15 border-t-accent animate-spin [animation-duration:0.9s] motion-reduce:animate-none" />
        <p className="text-gray-400">Looking up ticket…</p>
      </div>
    )
  }

  if (error && !ticket) {
    return (
      <div className={`${CARD} p-4 sm:p-6 space-y-5`}>
        <VerdictBanner
          surface="bg-red-500/20 border-red-400/60"
          ink="text-red-300"
          mark={<QueryMark />}
          headline="NOT FOUND"
          detail={error}
        />
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-500">Scanned code</p>
          <p className="mt-1 font-mono text-sm text-gray-300 break-all">{orderId}</p>
        </div>
      </div>
    )
  }

  if (!ticket) return null

  const marked = days.filter((d) => d.present).length

  return (
    <div className={`${CARD} p-4 sm:p-6 space-y-5`}>
      <Verdict ticket={ticket} />

      <div>
        <p className="text-2xl font-bold text-white leading-tight break-words">{ticket.name}</p>
        <p className="mt-1.5 font-medium text-accent-soft">{ticket.description}</p>
        <p className="mt-1.5 text-sm text-gray-400">
          {[ticket.year, ticket.course, ticket.department].filter(Boolean).join(" · ") || "—"}
        </p>
        {/* Read aloud when something needs sorting out, so it is not the faintest
            thing on the screen. */}
        <p className="mt-3 font-mono text-sm tracking-wide text-gray-300 break-all">{ticket.orderId}</p>
      </div>

      <div className="border-t border-white/10 pt-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">
            {ticket.readOnly ? "Attendance record" : "Mark attendance"}
          </h2>
          {days.length > 0 && (
            <span className="shrink-0 text-sm font-semibold text-gray-400">
              {marked}/{days.length} present
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 mb-3">
          {ticket.readOnly
            ? "Archived 2025 record. Attendance cannot be changed."
            : `${ticket.days.length} ${ticket.days.length === 1 ? "day" : "days"} on this ticket.`}
        </p>

        <div className="space-y-3">
          {days.length === 0 && (
            <p className="text-sm text-gray-500">No attendance days on this registration.</p>
          )}
          {days.map((day) => (
            <label
              key={day.key}
              className={`flex items-center gap-4 min-h-[4.5rem] px-4 rounded-xl border transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-soft ${
                ticket.readOnly
                  ? "border-white/10 bg-white/[0.03] cursor-not-allowed"
                  : day.present
                    ? "border-green-400/60 bg-green-500/15 cursor-pointer"
                    : "border-white/20 bg-white/5 cursor-pointer active:bg-white/10"
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
                    : "border-white/40 bg-white/5 text-transparent"
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
                  day.present ? "text-green-300" : "text-gray-500"
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
          <p className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-green-500/15 border border-green-400/40 text-green-300 text-center font-semibold py-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-5 w-5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.5l5 5 10-11" />
            </svg>
            Attendance saved
          </p>
        )}

        {!ticket.readOnly && (
          <button onClick={save} disabled={saving || !dirty} className={`${PRIMARY} mt-4`}>
            {saving ? "Saving…" : dirty ? "Save attendance" : "No changes"}
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

  return (
    <main className="min-h-screen text-white px-4 py-4 font-sans">
      <div className="w-full max-w-md mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-accent-soft">PFE Door Check</h1>
          <button
            onClick={() => {
              window.history.pushState({}, "", "/verify")
              setOrderId(null)
              logout()
            }}
            className="min-h-11 px-4 text-sm text-gray-300 hover:text-white bg-black/30 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-accent-soft/60 transition"
          >
            Log out
          </button>
        </div>

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
          <TicketPanel orderId={orderId} creds={creds} onScanNext={scanNext} />
        ) : (
          <div className={`${CARD} p-6 sm:p-8 text-center`}>
            <span
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-accent/35 bg-accent/10 text-accent"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-8 w-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V5.5A1.5 1.5 0 015.5 4H9M15 4h3.5A1.5 1.5 0 0120 5.5V9M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15M9 20H5.5A1.5 1.5 0 014 18.5V15" />
                <path strokeLinecap="round" d="M4 12h16" />
              </svg>
            </span>
            <h2 className="mt-5 text-2xl font-bold text-white">Ready to verify</h2>
            <p className="mt-2 mb-6 text-gray-400">Scan a ticket QR to check it in.</p>
            <button
              onClick={() => {
                setScanError("")
                setScanning(true)
              }}
              className={PRIMARY}
            >
              Start scanning
            </button>
          </div>
        )}
      </div>
    </main>
  )
}

export default function VerifyPage() {
  return <AdminGate title="Admin Verification">{({ creds, logout }) => <VerifyScreen creds={creds} logout={logout} />}</AdminGate>
}
