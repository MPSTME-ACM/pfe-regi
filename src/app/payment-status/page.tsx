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
    year: string;
    course: string;
}

const StatusDisplay = () => {
    const [status, setStatus] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [details, setDetails] = useState<RegistrationDetails | null>(null);

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
    }, []);

    const renderStatus = () => {
        if (loading) {
            return (
                <div className="flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-[#e97bfc]"></div>
                    <p className="text-xl text-gray-300 mt-4">Verifying Payment...</p>
                </div>
            );
        }

        switch (status) {
            case 'Success':
                if (!details) return null;
                return (
                    <div className="w-full max-w-sm sm:max-w-md animate-fade-in">
                        <div className="text-center mb-8">
                             <h1 className="text-3xl sm:text-4xl font-bold text-white">Payment Successful!</h1>
                             <p className="text-gray-400 mt-2">Your Event Pass is ready.</p>
                        </div>

                        {/* Ticket Layout */}
                        <div className="relative bg-black/50 backdrop-blur-md rounded-2xl border border-pink-500/30 shadow-2xl shadow-pink-500/20 p-1 progress-glow-container">
                             {/* Ticket Cutouts */}
                            <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-[#0d0d1a] rounded-full"></div>
                            <div className="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-[#0d0d1a] rounded-full"></div>

                            <div className="p-6 sm:p-8">
                                <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8">
                                    {/* QR Code Section */}
                                    <div className="flex-shrink-0">
                                        {details.qrCodeUrl && (
                                            <Image 
                                                src={details.qrCodeUrl} 
                                                alt="Registration QR Code" 
                                                width={128} 
                                                height={128} 
                                                className="bg-white p-1 rounded-lg w-32 h-32" 
                                            />
                                        )}
                                    </div>
                                    {/* Details Section */}
                                    <div className="text-center sm:text-left border-t sm:border-t-0 sm:border-l border-dashed border-gray-600 pt-6 sm:pt-0 sm:pl-8 flex-grow">
                                        <h2 className="text-2xl font-bold text-white leading-tight">{details.name}</h2>
                                        <p className="text-lg text-pink-400 mt-1">{details.domain}</p>
                                        <p className="text-sm text-gray-400 mt-3">{details.course} &bull; {details.year}</p>
                                        <p className="text-xs text-gray-500 tracking-wider font-mono mt-4 uppercase">Booking ID</p>
                                        <p className="text-xs text-gray-300 tracking-wider font-mono">{details.orderId}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                         <p className="text-xs text-gray-500 mt-6 text-center">A confirmation email with your ticket has been sent to your registered email address.</p>

                    </div>
                );
            case 'Pending':
                 return (
                    <div className="w-full max-w-md text-center">
                        <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-yellow-400 mx-auto mb-6"></div>
                        <h1 className="text-4xl font-bold text-yellow-400 mb-4">Payment Pending</h1>
                        <p className="text-lg text-gray-300">Your payment is being processed. This can take a few moments.</p>
                        <p className="text-sm text-gray-500 mt-2">We will send a confirmation email once it's successful.</p>
                    </div>
                );
            case 'Failure':
            default:
                 return (
                    <div className="w-full max-w-md text-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                        <h1 className="text-4xl font-bold text-red-500 mb-4">Payment Failed</h1>
                        <p className="text-lg text-gray-300">Unfortunately, your payment could not be processed.</p>
                         <Link href="/" className="mt-8 inline-block bg-gray-700 text-white font-bold py-3 px-6 rounded-lg text-lg hover:bg-gray-600 transition-colors duration-300">
                            Try Again
                        </Link>
                    </div>
                );
        }
    };

    return <>{renderStatus()}</>;
};

export default function PaymentStatusPage() {
    return (
        <main className="min-h-screen bg-[#0d0d1a] text-white flex flex-col items-center justify-center p-4 font-sans relative overflow-hidden">
            <div
                className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-[#0d0d1a] via-[#1a0d1d] to-[#0d0d1a] animate-gradient-xy"
                style={{ zIndex: -1 }}
            ></div>
            <Suspense fallback={<div className="text-2xl text-gray-400">Loading Page...</div>}>
                <StatusDisplay />
            </Suspense>
        </main>
    );
}

