"use client";
import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';

// Define a type for the registration details we expect from the API
interface RegistrationDetails {
    name: string;
    domain: string;
    orderId: string;
    qrCodeUrl: string | null;
}

const StatusDisplay = () => {
    const [status, setStatus] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [details, setDetails] = useState<RegistrationDetails | null>(null);

    // Combined into a single useEffect to prevent re-render loops.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const orderId = params.get('order_id');

        const fetchStatus = async (id: string) => {
            try {
                const response = await fetch('/api/get-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order_id: id }),
                });
                const data = await response.json();
                if (data.success) {
                    setStatus(data.status);

                    if (data.status === 'Success') {
                        setDetails(data.details);
                    }
                } else {
                    setStatus('Failure');
                }
            } catch (error) {
                console.error("Failed to fetch status:", error);
                setStatus('Failure');
            } finally {
                setLoading(false);
            }
        };

        if (orderId) {
            fetchStatus(orderId);
        } else {
            setStatus('Failure');
            setLoading(false);
        }
    }, []); // Empty dependency array ensures this runs only once.


    if (loading) {
        return <div className="text-2xl text-gray-400">Verifying Payment...</div>;
    }

    if (status === 'Success' && details) {
        console.log('Rendering success with details:', details); // Debug log
        console.log('QR Code URL:', details.qrCodeUrl); // Debug log
        return (
            <div className="w-full max-w-md bg-gray-900/50 backdrop-blur-lg rounded-2xl p-8 border border-pink-500/30 shadow-2xl shadow-pink-500/20 animate-fade-in">
                <div className="text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <h1 className="text-2xl font-bold text-green-400">Payment Successful!</h1>
                    <p className="text-gray-300 mt-1">Your ticket is ready.</p>
                </div>

                <div className="mt-8 text-center">

                    <p className="text-xs text-gray-500 mb-2">QR Code Status: {details.qrCodeUrl ? 'Available' : 'Not Available'}</p>

                    {details.qrCodeUrl && (
                        <img src={details.qrCodeUrl} alt="Your QR Code" width={192} height={192} className="w-48 h-48 mx-auto rounded-lg bg-white p-2" />
                    )}
                </div>

                <div className="mt-8 border-t border-dashed border-gray-600 pt-6 space-y-3 text-center">
                    <p className="text-2xl font-bold text-white">{details.name}</p>
                    <p className="text-lg text-pink-400">{details.domain}</p>
                    <p className="text-xs text-gray-500 tracking-wider font-mono">{details.orderId}</p>
                </div>
            </div>
        );
    }

    // Fallback for Pending, Failure, or other states
    const renderFallbackStatus = () => {
        switch (status) {
            case 'Pending':
                return (
                    <div className="text-center">
                        <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-yellow-400 mx-auto mb-6"></div>
                        <h1 className="text-4xl font-bold text-yellow-400 mb-4">Payment Pending</h1>
                        <p className="text-lg text-gray-300">Your payment is being processed. This can take a few moments.</p>
                        <p className="text-sm text-gray-500 mt-2">We will send a confirmation email once it&apos;s successful.</p>
                    </div>
                );
            case 'Failure':
            default:
                return (
                    <div className="text-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                        <h1 className="text-4xl font-bold text-red-500 mb-4">Payment Failed</h1>
                        <p className="text-lg text-gray-300">Unfortunately, your payment could not be processed. Please try again.</p>
                    </div>
                );
        }
    };

    return (
        <div className="text-center">
            {renderFallbackStatus()}
            <Link href="/" className="mt-8 inline-block bg-gray-700 text-white font-bold py-3 px-6 rounded-lg text-lg hover:bg-gray-600 transition-colors duration-300">
                Back to Home
            </Link>
        </div>
    );
};

export default function PaymentStatusPage() {
    return (
        <div className="min-h-screen bg-[#0d0d1a] text-white flex flex-col items-center justify-center p-4">
            <Suspense fallback={<div className="text-2xl text-gray-400">Loading Page...</div>}>
                <StatusDisplay />
            </Suspense>
        </div>
    );
}

