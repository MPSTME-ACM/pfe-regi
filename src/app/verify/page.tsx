"use client"
import type React from "react"
import { useState, useEffect, Suspense } from "react"
// Use a type-only import to satisfy TypeScript without affecting the runtime
import type { Html5QrcodeScanner, QrcodeSuccessCallback } from "html5-qrcode"

// --- Type Definitions ---
interface RegistrationDetails {
  name: string
  domain: string
  orderId: string
  attendance: boolean[]
  year: string
  course: string
}

// --- Admin Login Component ---
const AdminLogin = ({
  onLogin,
  error,
  setError,
}: { onLogin: (user: string, pass: string) => void; error: string; setError: (err: string) => void }) => {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) {
      setError("Username and Password are required.")
      return
    }
    setError("")
    onLogin(username, password)
  }

  return (
    <div className="w-full max-w-sm p-8 bg-black/50 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl shadow-[#e97bfc]/10">
      <h2 className="text-2xl font-bold text-center text-white mb-6">Admin Verification</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc] transition-all"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full mt-4 bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc] transition-all"
        />
        {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}
        <button
          type="submit"
          className="w-full mt-6 bg-[#e97bfc] text-black font-bold py-3 px-6 rounded-lg text-lg transition-all duration-300 ease-in-out transform hover:scale-105 hover:shadow-lg hover:shadow-[#e97bfc]/50 active:scale-95"
        >
          Authenticate
        </button>
      </form>
    </div>
  )
}

// --- QR Code Scanner Component ---
const QrScanner = ({
  onScanSuccess,
  onScanError,
  onStop,
}: { onScanSuccess: QrcodeSuccessCallback; onScanError: (error: string) => void; onStop: () => void }) => {
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
        scanner.render(onScanSuccess, onScanError)
      })
      .catch((err: unknown) => {
        console.error("Failed to load Html5QrcodeScanner", err)
      })

    return () => {
      if (scanner) {
        scanner.clear().catch((error: unknown) => console.error("Failed to clear scanner.", error))
      }
    }
  }, [onScanSuccess, onScanError])

  return (
    <div className="w-full max-w-md p-6 bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl shadow-[#e97bfc]/10">
      <h3 className="text-lg font-semibold text-white mb-2 text-center">Scan QR Code</h3>
      <p className="text-center text-gray-400 text-sm mb-4">Align the ticket QR inside the square.</p>
      <div
        id="reader"
        className="w-full bg-white/5 rounded-xl overflow-hidden border border-white/15"
        aria-label="QR code scanner"
      />
      <div className="w-full text-center">
        <button
          onClick={onStop}
          className="mt-6 w-full text-white font-medium py-3 px-4 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc]/60 transition"
          aria-label="Close scanner"
        >
          Close Scanner
        </button>
      </div>

      <style jsx global>{`
                /* Scanner control cleanup with brand accent (#e97bfc) */
                #reader {
                    padding: 10px;
                }
                #reader button,
                #reader a,
                #reader select {
                    font-size: 14px;
                    border-radius: 12px !important;
                    padding: 10px 14px !important;
                    min-height: 44px;
                    min-width: 44px;
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
                /* tighten dashboard spacing a bit while keeping touch targets large */
                #reader__dashboard_section_csr,
                #reader__dashboard_section {
                    gap: 12px;
                }
            `}</style>
    </div>
  )
}

// --- Verification Details Display Component ---
const VerificationDisplay = ({ orderId, authCreds }: { orderId: string; authCreds: string }) => {
  const [details, setDetails] = useState<RegistrationDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [attendance, setAttendance] = useState<boolean[]>([])

  useEffect(() => {
    const fetchDetails = async () => {
      try {
        const response = await fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authCreds },
          body: JSON.stringify({ orderId }),
        })
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.message || "Ticket not found.")
        }
        const data = await response.json()
        if (data.success) {
          setDetails(data.details)
          setAttendance(data.details.attendance)
        } else {
          setError(data.message)
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "An unknown error occurred.")
      } finally {
        setLoading(false)
      }
    }
    fetchDetails()
  }, [orderId, authCreds])

  const handleAttendanceChange = (dayIndex: number) => {
    const newAttendance = [...attendance]
    newAttendance[dayIndex] = !newAttendance[dayIndex]
    setAttendance(newAttendance)
  }

  const handleSaveAttendance = async () => {
    try {
      const response = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authCreds },
        body: JSON.stringify({ orderId, attendance }),
      })
      if (!response.ok) throw new Error("Failed to save attendance.")
      alert("Attendance updated successfully!")
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "An error occurred.")
    }
  }

  if (loading)
    return (
      <div className="w-12 h-12 border-4 border-dashed rounded-full animate-spin border-[#e97bfc] [animation-duration:2s]"></div>
    )
  if (error) return <p className="text-2xl text-red-500">{error}</p>
  if (!details) return <p className="text-2xl text-yellow-500">No details found.</p>

  return (
    <div className="w-full max-w-md p-8 bg-black/50 backdrop-blur-md rounded-2xl border border-pink-500/30 text-center progress-glow-container">
      <h1 className="text-2xl font-bold text-green-400 mb-4">Ticket Verified</h1>
      <div className="text-left space-y-3 my-6 border-y border-dashed border-gray-700 py-6">
        <p>
          <span className="font-semibold text-gray-400 w-24 inline-block">Name:</span> {details.name}
        </p>
        <p>
          <span className="font-semibold text-gray-400 w-24 inline-block">Domain:</span> {details.domain}
        </p>
        <p>
          <span className="font-semibold text-gray-400 w-24 inline-block">Details:</span> {details.year},{" "}
          {details.course}
        </p>
        <p>
          <span className="font-semibold text-gray-400 w-24 inline-block">Order ID:</span> {details.orderId}
        </p>
      </div>
      <div>
        <h2 className="text-xl font-bold mb-4">Mark Attendance</h2>
        <div className="flex justify-around">
          {[...Array(3)].map((_, index) => (
            <div key={index} className="flex flex-col items-center gap-2">
              <label htmlFor={`day-${index}`} className="text-gray-300">
                Day {index + 1}
              </label>
              <input
                type="checkbox"
                id={`day-${index}`}
                checked={attendance[index] || false}
                onChange={() => handleAttendanceChange(index)}
                className="w-6 h-6 md:w-7 md:h-7 rounded text-[#e97bfc] bg-gray-700 border-gray-600 focus:ring-2 focus:ring-[#f8c8fc]/60 cursor-pointer"
              />
            </div>
          ))}
        </div>
        <button
          onClick={handleSaveAttendance}
          className="w-full mt-8 bg-green-600 text-white font-bold py-3 rounded-lg hover:bg-green-700 transition-colors"
        >
          Save Attendance
        </button>
      </div>
    </div>
  )
}

// --- Main Page Content Logic ---
const VerifyPageContent = () => {
  const [authCreds, setAuthCreds] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [orderId, setOrderId] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState(false)

  useEffect(() => {
    const storedCreds = sessionStorage.getItem("admin-creds")
    if (storedCreds) {
      setAuthCreds(storedCreds)
    }
    const params = new URLSearchParams(window.location.search)
    const id = params.get("orderId")
    if (id) {
      setOrderId(id)
    }
  }, [])

  const handleLogin = async (user: string, pass: string) => {
    const creds = `Basic ${btoa(`${user}:${pass}`)}`;

    try {
      const res = await fetch('/api/login', {
        headers: { Authorization: creds },
      });
      if (!res.ok) {
        setError('Invalid username or password');
        return;
      }
      setError('');
      sessionStorage.setItem('admin-creds', creds);
      setAuthCreds(creds);
    } catch {
      setError('Network error during authentication');
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("admin-creds")
    setAuthCreds(null)
    setError("")
    window.history.pushState({}, "", "/verify")
    setOrderId(null)
  }

  const onScanSuccess: QrcodeSuccessCallback = (decodedText) => {
    try {
      const url = new URL(decodedText)
      const id = url.searchParams.get("orderId")
      if (id) {
        // Use window.history to change URL without a full page reload,
        // triggering the details fetch.
        window.history.pushState({}, "", `/verify?orderId=${id}`)
        setOrderId(id)
      } else {
        throw new Error("No orderId found in QR code.")
      }
    } catch (err: unknown) {
      console.error("QR Scan Error:", err)
      alert("Invalid QR Code. Please scan a valid PFE Ticket.")
    }
    setIsScanning(false)
  }

  // FIX: Explicitly type the error message parameter as a string
  const onScanError = (errorMessage: string) => {
    console.error(errorMessage);
    // This callback is required but we can choose to ignore minor errors.
  }

  if (!authCreds) {
    return <AdminLogin onLogin={handleLogin} error={error} setError={setError} />
  }

  return (
    <div className="relative w-full max-w-md flex flex-col items-center">
      <button
        onClick={handleLogout}
        className="fixed top-4 right-4 z-50 text-sm text-gray-300 hover:text-white transition-colors bg-black/30 px-3 py-2 rounded-lg backdrop-blur-sm border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc]/60"
      >
        Logout
      </button>

      {isScanning ? (
        <QrScanner onScanSuccess={onScanSuccess} onScanError={onScanError} onStop={() => setIsScanning(false)} />
      ) : orderId ? (
        <VerificationDisplay orderId={orderId} authCreds={authCreds} />
      ) : (
        <div className="text-center p-8 bg-black/50 backdrop-blur-md rounded-2xl border border-white/10">
          <h1 className="text-3xl font-bold text-white mb-2">Ready to Verify</h1>
          <p className="text-gray-400">Click the button below to start scanning.</p>
        </div>
      )}

      {!isScanning && (
        <button
          onClick={() => setIsScanning(true)}
          className="mt-8 w-full bg-[#e97bfc] text-black font-semibold py-3.5 px-6 rounded-xl shadow-lg shadow-[#e97bfc]/30 hover:shadow-[#e97bfc]/40 transition focus:outline-none focus:ring-2 focus:ring-[#f8c8fc]/70 active:translate-y-px"
          aria-label="Start scanning next ticket"
        >
          Scan Next Ticket
        </button>
      )}
    </div>
  )
}

// --- Main Page Component ---
export default function VerifyPage() {
  return (
    <main className="min-h-screen bg-transparent text-white flex items-center justify-center p-4 font-sans">
      <Suspense fallback={<div className="text-2xl">Loading...</div>}>
        <VerifyPageContent />
      </Suspense>
    </main>
  )
}
