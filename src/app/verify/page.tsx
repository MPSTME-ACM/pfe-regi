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
      <h2 className="text-lg font-semibold text-[#f8c8fc] mb-1 text-center">Scan ticket</h2>
      <p className="text-center text-gray-400 text-sm mb-4">Align the QR inside the square.</p>
      <div
        id="reader"
        className="w-full bg-white/5 rounded-xl overflow-hidden border border-white/15"
        aria-label="QR code scanner"
      />
      <button
        onClick={onStop}
        className="mt-5 w-full min-h-14 text-white font-semibold rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc]/60 transition"
      >
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

const Verdict = ({ ticket }: { ticket: TicketView }) => {
  if (ticket.edition === 2025) {
    return (
      <div className="rounded-xl bg-amber-500/15 border border-amber-400/50 px-4 py-4 text-center">
        <p className="text-xl font-extrabold text-amber-300 tracking-wide">2025 REGISTRATION</p>
        <p className="text-sm text-amber-200/80 mt-1">Archived ticket &middot; read-only</p>
      </div>
    )
  }

  const paid = PAID_STATUSES.includes(ticket.paymentStatus ?? "")
  if (!paid) {
    return (
      <div className="rounded-xl bg-red-500/20 border border-red-400/60 px-4 py-4 text-center">
        <p className="text-2xl font-extrabold text-red-300 tracking-wide">NOT PAID</p>
        <p className="text-sm text-red-200/80 mt-1">
          Payment status: {ticket.paymentStatus ?? "unknown"} &middot; do not admit
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-green-500/15 border border-green-400/50 px-4 py-4 text-center">
      <p className="text-2xl font-extrabold text-green-300 tracking-wide">VALID TICKET</p>
      {ticket.paymentStatus === "comped" && (
        <p className="text-sm text-green-200/80 mt-1">Comped registration</p>
      )}
    </div>
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
        <div className="w-12 h-12 border-4 border-dashed rounded-full animate-spin border-[#e97bfc] [animation-duration:2s]" />
        <p className="text-gray-400">Looking up ticket…</p>
      </div>
    )
  }

  if (error && !ticket) {
    return (
      <div className={`${CARD} p-6 text-center`}>
        <div className="rounded-xl bg-red-500/20 border border-red-400/60 px-4 py-5">
          <p className="text-2xl font-extrabold text-red-300 tracking-wide">NOT FOUND</p>
          <p className="text-sm text-red-200/80 mt-2">{error}</p>
        </div>
        <p className="text-xs text-gray-500 font-mono mt-4 break-all">{orderId}</p>
      </div>
    )
  }

  if (!ticket) return null

  return (
    <div className={`${CARD} p-4 sm:p-6 space-y-5`}>
      <Verdict ticket={ticket} />

      <div className="space-y-2">
        <p className="text-2xl font-bold text-white leading-tight break-words">{ticket.name}</p>
        <p className="text-[#f8c8fc] font-medium">{ticket.description}</p>
        <p className="text-sm text-gray-400">
          {[ticket.year, ticket.course, ticket.department].filter(Boolean).join(" · ") || "—"}
        </p>
        <p className="text-xs text-gray-500 font-mono break-all pt-1">{ticket.orderId}</p>
      </div>

      <div className="border-t border-white/10 pt-5">
        <h2 className="text-lg font-semibold text-white mb-1">Mark attendance</h2>
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
              className={`flex items-center gap-4 min-h-16 px-4 rounded-xl border transition-colors ${
                ticket.readOnly
                  ? "border-white/10 bg-white/5 opacity-70 cursor-not-allowed"
                  : day.present
                    ? "border-green-400/60 bg-green-500/15 cursor-pointer"
                    : "border-white/20 bg-white/5 cursor-pointer active:bg-white/10"
              }`}
            >
              <input
                type="checkbox"
                checked={day.present}
                disabled={ticket.readOnly}
                onChange={() => toggle(day.key)}
                className="w-7 h-7 shrink-0 rounded accent-[#e97bfc] bg-white/10 border-white/30 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc]/70 disabled:cursor-not-allowed"
              />
              <span className="flex-1 text-lg font-semibold text-white">{day.label}</span>
              <span
                className={`text-sm font-semibold ${day.present ? "text-green-300" : "text-gray-500"}`}
              >
                {day.present ? "Present" : "Absent"}
              </span>
            </label>
          ))}
        </div>

        {error && ticket && <p className="text-red-400 text-sm mt-3">{error}</p>}
        {saved && !dirty && (
          <p className="mt-3 rounded-lg bg-green-500/15 border border-green-400/40 text-green-300 text-center font-semibold py-3">
            Attendance saved
          </p>
        )}

        {!ticket.readOnly && (
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="w-full mt-4 min-h-14 bg-green-600 text-white text-lg font-bold rounded-xl hover:bg-green-500 focus:outline-none focus:ring-2 focus:ring-green-300/70 transition-colors disabled:opacity-40 disabled:hover:bg-green-600"
          >
            {saving ? "Saving…" : dirty ? "Save attendance" : "No changes"}
          </button>
        )}
      </div>

      <button
        onClick={onScanNext}
        className="w-full min-h-14 bg-[#e97bfc] text-black text-lg font-bold rounded-xl shadow-lg shadow-[#e97bfc]/30 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc]/70 active:translate-y-px transition"
      >
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
          <h1 className="text-xl font-bold text-[#f8c8fc]">PFE Door Check</h1>
          <button
            onClick={() => {
              window.history.pushState({}, "", "/verify")
              setOrderId(null)
              logout()
            }}
            className="min-h-11 px-4 text-sm text-gray-300 hover:text-white bg-black/30 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc]/60 transition"
          >
            Log out
          </button>
        </div>

        {scanError && (
          <p className="mb-4 rounded-lg bg-red-500/20 border border-red-400/50 text-red-300 text-center font-semibold py-3">
            {scanError}
          </p>
        )}

        {scanning ? (
          <QrScanner onScanSuccess={onScanSuccess} onStop={() => setScanning(false)} />
        ) : orderId ? (
          <TicketPanel orderId={orderId} creds={creds} onScanNext={scanNext} />
        ) : (
          <div className={`${CARD} p-6 text-center`}>
            <h2 className="text-2xl font-bold text-white mb-2">Ready to verify</h2>
            <p className="text-gray-400 mb-6">Scan a ticket QR to check it in.</p>
            <button
              onClick={() => {
                setScanError("")
                setScanning(true)
              }}
              className="w-full min-h-14 bg-[#e97bfc] text-black text-lg font-bold rounded-xl shadow-lg shadow-[#e97bfc]/30 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc]/70 active:translate-y-px transition"
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
