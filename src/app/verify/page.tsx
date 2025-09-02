"use client";
import React, { useState, useEffect, Suspense } from 'react';

// Define the type for registration data, including attendance
interface RegistrationDetails {
    name: string;
    domain: string;
    orderId: string;
    attendance: boolean[];
    year: string;
    course: string;
}

// --- Admin Login Component ---
const AdminLogin = ({ onLogin, error, setError }: { onLogin: (user: string, pass: string) => void, error: string, setError: (err: string) => void }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!username || !password) {
            setError('Username and Password are required.');
            return;
        }
        setError('');
        onLogin(username, password);
    };

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
                <button type="submit" className="w-full mt-6 bg-[#e97bfc] text-black font-bold py-3 px-6 rounded-lg text-lg transition-all duration-300 ease-in-out transform hover:scale-105 hover:shadow-lg hover:shadow-[#e97bfc]/50 active:scale-95">
                    Authenticate
                </button>
            </form>
        </div>
    );
};

// --- QR Code Scanner Component ---
const QrScanner = ({ onScanSuccess, onScanError, onStop }: { onScanSuccess: (decodedText: string) => void, onScanError: (error: any) => void, onStop: () => void }) => {
    useEffect(() => {
        let scanner: any;

        // FIX: Dynamically import the library to ensure it only runs on the client-side.
        import('html5-qrcode').then(({ Html5QrcodeScanner }) => {
            scanner = new Html5QrcodeScanner(
                "reader", 
                { fps: 10, qrbox: { width: 250, height: 250 } }, 
                false
            );
            scanner.render(onScanSuccess, onScanError);
        }).catch((err: unknown) => {
            console.error("Failed to load Html5QrcodeScanner", err);
        });

        return () => {
            if (scanner) {
                // Check if the scanner has been initialized before trying to clear
                scanner.clear().catch((error: Error) => console.error("Failed to clear scanner.", error));
            }
        };
    }, [onScanSuccess, onScanError]);

    return (
        <div className="w-full max-w-md p-6 bg-black/50 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl shadow-[#e97bfc]/10">
            <div id="reader" className="w-full bg-black rounded-lg overflow-hidden"></div>
            <button onClick={onStop} className="w-full mt-4 bg-red-600 text-white font-bold py-2 rounded-lg hover:bg-red-700 transition-colors">
                Close Scanner
            </button>
        </div>
    );
};


// --- Verification Details Display Component ---
const VerificationDisplay = ({ orderId, authCreds }: { orderId: string, authCreds: string }) => {
    const [details, setDetails] = useState<RegistrationDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [attendance, setAttendance] = useState<boolean[]>([]);

    useEffect(() => {
        const fetchDetails = async () => {
            try {
                const response = await fetch('/api/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': authCreds },
                    body: JSON.stringify({ orderId }),
                });
                if (!response.ok) {
                    const data = await response.json();
                    throw new Error(data.message || 'Ticket not found.');
                }
                const data = await response.json();
                if (data.success) {
                    setDetails(data.details);
                    setAttendance(data.details.attendance);
                } else { setError(data.message); }
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'An unknown error occurred.');
            } finally {
                setLoading(false);
            }
        };
        fetchDetails();
    }, [orderId, authCreds]);
    
    const handleAttendanceChange = (dayIndex: number) => {
        const newAttendance = [...attendance];
        newAttendance[dayIndex] = !newAttendance[dayIndex];
        setAttendance(newAttendance);
    };

    const handleSaveAttendance = async () => {
        try {
            const response = await fetch('/api/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': authCreds },
                body: JSON.stringify({ orderId, attendance }),
            });
            if (!response.ok) throw new Error('Failed to save attendance.');
            alert('Attendance updated successfully!');
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : 'An error occurred.');
        }
    };

    if (loading) return <div className="w-12 h-12 border-4 border-dashed rounded-full animate-spin border-[#e97bfc] [animation-duration:2s]"></div>;
    if (error) return <p className="text-2xl text-red-500">{error}</p>;
    if (!details) return <p className="text-2xl text-yellow-500">No details found.</p>;

    return (
        <div className="w-full max-w-md p-8 bg-black/50 backdrop-blur-md rounded-2xl border border-pink-500/30 text-center progress-glow-container">
            <h1 className="text-2xl font-bold text-green-400 mb-4">Ticket Verified</h1>
            <div className="text-left space-y-3 my-6 border-y border-dashed border-gray-700 py-6">
                <p><span className="font-semibold text-gray-400 w-24 inline-block">Name:</span> {details.name}</p>
                <p><span className="font-semibold text-gray-400 w-24 inline-block">Domain:</span> {details.domain}</p>
                <p><span className="font-semibold text-gray-400 w-24 inline-block">Details:</span> {details.year}, {details.course}</p>
                <p><span className="font-semibold text-gray-400 w-24 inline-block">Order ID:</span> {details.orderId}</p>
            </div>
            <div>
                <h2 className="text-xl font-bold mb-4">Mark Attendance</h2>
                <div className="flex justify-around">
                    {attendance.map((attended, index) => (
                        <div key={index} className="flex flex-col items-center gap-2">
                            <label htmlFor={`day-${index}`} className="text-gray-300">Day {index + 1}</label>
                            <input
                                type="checkbox"
                                id={`day-${index}`}
                                checked={attended}
                                onChange={() => handleAttendanceChange(index)}
                                className="w-6 h-6 rounded text-[#e97bfc] bg-gray-700 border-gray-600 focus:ring-[#e97bfc] focus:ring-offset-0"
                            />
                        </div>
                    ))}
                </div>
                <button onClick={handleSaveAttendance} className="w-full mt-8 bg-green-600 text-white font-bold py-3 rounded-lg hover:bg-green-700 transition-colors">
                    Save Attendance
                </button>
            </div>
        </div>
    );
};

// --- Main Page Content Logic ---
const VerifyPageContent = () => {
    const [authCreds, setAuthCreds] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [orderId, setOrderId] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState(false);

    useEffect(() => {
        const storedCreds = sessionStorage.getItem('admin-creds');
        if (storedCreds) {
            setAuthCreds(storedCreds);
        }
        const params = new URLSearchParams(window.location.search);
        setOrderId(params.get('orderId'));
    }, []);

    const handleLogin = (user: string, pass: string) => {
        const creds = `Basic ${btoa(`${user}:${pass}`)}`;
        sessionStorage.setItem('admin-creds', creds);
        setAuthCreds(creds);
    };

    const handleLogout = () => {
        sessionStorage.removeItem('admin-creds');
        setAuthCreds(null);
        setError('');
    };

    const onScanSuccess = (decodedText: string) => {
        try {
            const url = new URL(decodedText);
            const id = url.searchParams.get('orderId');
            if (id) {
                window.location.href = `/verify?orderId=${id}`;
            } else {
                throw new Error("No orderId found in QR code.");
            }
        } catch (err: unknown) {
            console.error("QR Scan Error:", err);
            alert("Invalid QR Code. Please scan a valid PFE Ticket.");
        }
        setIsScanning(false);
    };

    if (!authCreds) {
        return <AdminLogin onLogin={handleLogin} error={error} setError={setError} />;
    }

    if (isScanning) {
        return <QrScanner onScanSuccess={onScanSuccess} onScanError={(err: Error) => console.warn(err.message)} onStop={() => setIsScanning(false)} />;
    }

    return (
        <div className="relative w-full max-w-md flex flex-col items-center">
             <button onClick={handleLogout} className="absolute -top-4 -right-4 text-sm text-gray-400 hover:text-white">Logout</button>
            
            {orderId ? (
                <VerificationDisplay orderId={orderId} authCreds={authCreds} />
            ) : (
                <div className="text-center p-8 bg-black/50 backdrop-blur-md rounded-2xl border border-white/10">
                    <p className="text-2xl text-yellow-500">Scan a ticket to begin.</p>
                </div>
            )}

            <button onClick={() => setIsScanning(true)} className="w-auto mx-auto mt-8 text-center text-lg text-[#e97bfc] font-bold transition-all duration-300 transform hover:scale-110 hover:shadow-lg hover:shadow-[#e97bfc]/20">
                Scan Next Ticket
            </button>
        </div>
    );
}

// --- Main Page Component ---
export default function VerifyPage() {
    return (
        <main className="min-h-screen bg-[#0d0d1a] text-white flex items-center justify-center p-4 font-sans relative overflow-hidden">
            {/* Re-using the animated gradient from main page */}
            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-[#0d0d1a] via-[#1a0d1d] to-[#0d0d1a] animate-gradient-xy -z-10"></div>
            <Suspense fallback={<div className="text-2xl">Loading...</div>}>
                <VerifyPageContent />
            </Suspense>
        </main>
    );
}

