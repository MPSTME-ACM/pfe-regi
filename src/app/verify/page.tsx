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

// Admin login component
const AdminLogin = ({ onLogin }: { onLogin: (password: string) => void }) => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!password) {
            setError('Password is required.');
            return;
        }
        setError('');
        onLogin(password);
    };

    return (
        <div className="w-full max-w-sm p-8 bg-black/50 backdrop-blur-md rounded-2xl border border-white/10">
            <h2 className="text-2xl font-bold text-center text-white mb-6">Admin Access Required</h2>
            <form onSubmit={handleSubmit}>
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter Admin Password"
                    className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc]"
                />
                {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
                <button type="submit" className="w-full mt-6 bg-[#e97bfc] text-black font-bold py-3 px-6 rounded-lg text-lg hover:scale-105 transition-transform">
                    Authenticate
                </button>
            </form>
        </div>
    );
};

// Verification details display
const VerificationDisplay = ({ orderId, password }: { orderId: string, password: string }) => {
    const [details, setDetails] = useState<RegistrationDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [attendance, setAttendance] = useState<boolean[]>([]);

    useEffect(() => {
        const fetchDetails = async () => {
            try {
                const response = await fetch('/api/verify', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Basic ${btoa(`admin:${password}`)}`
                    },
                    body: JSON.stringify({ orderId }),
                });

                if (response.status === 401) {
                    setError('Authentication failed. Invalid credentials.');
                    setLoading(false);
                    return;
                }
                if (!response.ok) {
                    const data = await response.json();
                    throw new Error(data.message || 'Ticket not found.');
                }

                const data = await response.json();
                if (data.success) {
                    setDetails(data.details);
                    setAttendance(data.details.attendance);
                } else {
                    setError(data.message);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'An unknown error occurred.');
            } finally {
                setLoading(false);
            }
        };
        fetchDetails();
    }, [orderId, password]);
    
    const handleAttendanceChange = (dayIndex: number) => {
        const newAttendance = [...attendance];
        newAttendance[dayIndex] = !newAttendance[dayIndex];
        setAttendance(newAttendance);
    };

    const handleSaveAttendance = async () => {
        try {
            const response = await fetch('/api/verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${btoa(`admin:${password}`)}`
                },
                body: JSON.stringify({ orderId, attendance }),
            });
            if (!response.ok) throw new Error('Failed to save attendance.');
            alert('Attendance updated successfully!');
        } catch (err) {
            alert(err instanceof Error ? err.message : 'An error occurred.');
        }
    };


    if (loading) return <div className="w-12 h-12 border-4 border-dashed rounded-full animate-spin border-[#e97bfc]"></div>;
    if (error) return <p className="text-2xl text-red-500">{error}</p>;
    if (!details) return <p className="text-2xl text-yellow-500">No details found for this ticket.</p>;

    return (
        <div className="w-full max-w-md p-8 bg-black/50 backdrop-blur-md rounded-2xl border border-white/10 text-center">
            <h1 className="text-2xl font-bold text-green-400 mb-4">Ticket Verified</h1>
            <div className="text-left space-y-3">
                <p><span className="font-semibold text-gray-400">Name:</span> {details.name}</p>
                <p><span className="font-semibold text-gray-400">Domain:</span> {details.domain}</p>
                <p><span className="font-semibold text-gray-400">Year:</span> {details.year}, {details.course}</p>
                <p><span className="font-semibold text-gray-400">Order ID:</span> {details.orderId}</p>
            </div>
            <div className="mt-6 border-t border-gray-700 pt-6">
                <h2 className="text-xl font-bold mb-4">Mark Attendance</h2>
                <div className="flex justify-around">
                    {attendance.map((attended, index) => (
                        <div key={index} className="flex flex-col items-center">
                            <label htmlFor={`day-${index}`} className="mb-2 text-gray-300">Day {index + 1}</label>
                            <input
                                type="checkbox"
                                id={`day-${index}`}
                                checked={attended}
                                onChange={() => handleAttendanceChange(index)}
                                className="w-6 h-6 rounded text-[#e97bfc] bg-gray-700 border-gray-600 focus:ring-[#e97bfc]"
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


const VerifyPageContent = () => {
    const [orderId, setOrderId] = useState<string | null>(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [password, setPassword] = useState('');

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        setOrderId(params.get('orderId'));
    }, []);

    if (!isAuthenticated) {
        return <AdminLogin onLogin={(pass) => { setPassword(pass); setIsAuthenticated(true); }} />;
    }

    if (!orderId) {
        return <p className="text-2xl text-yellow-500">No Order ID found in URL. Please scan a QR code.</p>;
    }
    
    return <VerificationDisplay orderId={orderId} password={password} />;
}


export default function VerifyPage() {
    return (
        <main className="min-h-screen bg-[#0d0d1a] text-white flex items-center justify-center p-4 font-sans">
            <Suspense fallback={<p>Loading...</p>}>
                <VerifyPageContent />
            </Suspense>
        </main>
    );
}
