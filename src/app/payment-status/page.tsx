// app/payment-status/page.tsx
"use client";
import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';


const StatusDisplay = () => {
    // State to hold the order_id from the URL
    const [order_id, setOrderId] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    // This effect runs once on the client-side to get the order_id from the URL
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const id = params.get('order_id');
        setOrderId(id);
    }, []);

    // This effect runs when the order_id state is updated
    useEffect(() => {
        if (order_id) {
            const fetchStatus = async () => {
                try {
                    setLoading(true);
                    const response = await fetch('/api/get-status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ order_id }),
                    });
                    const data = await response.json();
                    if (data.success) {
                        setStatus(data.status);
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
            fetchStatus();
        } else if (order_id === null) {
            // This handles the case where the order_id is not present in the URL
            setStatus('Failure');
            setLoading(false);
        }
    }, [order_id]);

    const renderStatus = () => {
        if (loading) {
            return <p className="text-2xl text-gray-300">Verifying Payment...</p>;
        }
        switch (status) {
            case 'Success':
                return (
                    <>
                        <h1 className="text-5xl font-bold text-green-400 mb-4">Payment Successful!</h1>
                        <p className="text-xl text-gray-200">Thank you for registering. Your spot is confirmed.</p>
                    </>
                );
            case 'Pending':
                return (
                    <>
                        {/* New Loading Spinner */}
                        <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-yellow-400 mx-auto mb-6"></div>
                        <h1 className="text-5xl font-bold text-yellow-400 mb-4">Payment Pending</h1>
                        <p className="text-xl text-gray-200">Your payment is being processed. This can take a few moments.</p>
                        <p className="text-md text-gray-400 mt-2">We will send a confirmation email once it&apos;s successful.</p>
                    </>
                );
            case 'Failure':
            default:
                return (
                    <>
                        <h1 className="text-5xl font-bold text-red-400 mb-4">Payment Failed</h1>
                        <p className="text-xl text-gray-200">Unfortunately, your payment could not be processed. Please try again.</p>
                    </>
                );
        }
    };

    return (
        <div className="min-h-screen bg-[#0d0d1a] text-white flex flex-col items-center justify-center text-center p-4">
            {renderStatus()}
            <Link href="/" className="mt-8 bg-[#e97bfc] text-black font-bold py-3 px-6 rounded-lg text-lg hover:bg-[#f8c8fc] transition-colors duration-300">
                Back to Home
            </Link>
        </div>
    );
};

// The Suspense wrapper is kept for good practice with client-side data fetching.
export default function PaymentStatusPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-[#0d0d1a] text-white flex items-center justify-center">Loading...</div>}>
            <StatusDisplay />
        </Suspense>
    );
}
