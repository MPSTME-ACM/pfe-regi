"use client";
import React, { useEffect, useState, Suspense, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { toJpeg } from "html-to-image";

interface RegistrationDetails {
    id: number;
    name: string;
    email: string;
    contact: string;
    course: string;
    department: string;
    year: string;
    domain: string;
    orderId: string;
    paymentStatus: string | null;
    createdAt: Date | null;
    qrCodeUrl: string | null;
}

const StatusDisplay = () => {
    const [status, setStatus] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [details, setDetails] = useState<RegistrationDetails | null>(null);
    const [hasRetried, setHasRetried] = useState(false);
    const ticketRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const fetchStatus = async (orderId: string) => {
        try {
            const response = await fetch("/api/get-status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ order_id: orderId }),
            });
            const data = await response.json();

            if (data.success) {
                setStatus(data.status);
                if (data.status === "Success") {
                    setDetails(data.details);
                }
            } else {
                setStatus("Failure");
            }
        } catch (error) {
            console.error("Failed to fetch status:", error);
            setStatus("Failure");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const orderId = params.get("order_id");
        if (!orderId) {
            setStatus("Failure");
            setLoading(false);
            return;
        }

        fetchStatus(orderId);
    }, []);

    // Retry fetching after 3 seconds if no QR code and not retried yet
    useEffect(() => {
        if (details && !details.qrCodeUrl && !hasRetried && status === "Success") {
            const retryTimeout = setTimeout(() => {
                const params = new URLSearchParams(window.location.search);
                const orderId = params.get("order_id");
                if (orderId) {
                    setHasRetried(true);
                    fetchStatus(orderId);
                }
            }, 1500);
            return () => clearTimeout(retryTimeout);
        }
    }, [details, hasRetried, status]);

    const handleDownload = () => {
        if (wrapperRef.current && details) {
            toJpeg(wrapperRef.current, {
                cacheBust: true,
                backgroundColor: "#0d0d1a",
                quality: 1.0,
                pixelRatio: 4,
                width: 800,
                height: 1200,
            })
                .then((dataUrl) => {
                    const link = document.createElement("a");
                    const fileName = `${details.name.replace(/\s+/g, "")}-PFE-Ticket.jpeg`;
                    link.download = fileName;
                    link.href = dataUrl;
                    link.click();
                })
                .catch((err) => {
                    console.error("Failed to generate ticket image:", err);
                    alert("Oops! Could not download the ticket. Please try taking a screenshot.");
                });
        }
    };

    const renderStatus = () => {
        if (loading) {
            return (
                <div className="flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-[#e97bfc] [animation-duration:2s]"></div>
                    <p className="text-xl text-gray-300 mt-4">Verifying Payment...</p>
                </div>
            );
        }

        switch (status) {
            case "Success":
                if (!details) return null;

                if (!details.qrCodeUrl) {
                    return (
                        <div className="w-full max-w-md sm:max-w-lg text-center">
                            <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-pink-400 mx-auto mb-6"></div>
                            <h1 className="text-3xl font-bold text-pink-400 mb-4">Generating Ticket...</h1>
                            <p className="text-gray-300">
                                Your payment is successful. We are generating your ticket.
                                Please wait a moment.
                            </p>
                        </div>
                    );
                }

                return (
                    <div
                        ref={wrapperRef}
                        className="w-full max-w-md sm:max-w-lg animate-fade-in flex flex-col items-center"
                    >
                        <div className="text-center mb-8">
                            <h1 className="text-3xl sm:text-4xl font-bold text-white">Payment Successful!</h1>
                            <p className="text-gray-400 mt-2">Your Ticket is ready.</p>
                        </div>

                        <div
                            ref={ticketRef}
                            className="relative bg-black/50 backdrop-blur-md rounded-2xl border border-[#f464d9] shadow-2xl shadow-pink-500/20 p-1 progress-glow-container w-full"
                            style={{ maxWidth: "400px", minHeight: "500px" }}
                        >
                            <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-[#0d0d1a] rounded-full"></div>
                            <div className="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-[#0d0d1a] rounded-full"></div>

                            <div className="p-6 sm:p-8">
                                <div className="flex flex-col items-center gap-6">
                                    <div className="flex-shrink-0 flex justify-center w-full">
                                        {details.qrCodeUrl && (
                                            <Image
                                                src={details.qrCodeUrl}
                                                alt="Registration QR Code"
                                                width={512}
                                                height={512}
                                                className="bg-white p-2 rounded-lg w-48 h-48"
                                                quality={100}
                                            />
                                        )}
                                    </div>
                                    <div className="text-center pt-6 flex-grow w-full">
                                        <h2 className="text-2xl font-bold text-white leading-tight">{details.name}</h2>
                                        <p className="text-lg text-pink-400 mt-1">Domain: {details.domain}</p>
                                        <p className="text-sm text-gray-400 mt-3">
                                            {details.course} &bull; {details.year}
                                        </p>
                                        <p className="text-xs text-gray-500 tracking-wider font-mono mt-4 uppercase">ORDER ID</p>
                                        <p className="text-xs text-gray-300 tracking-wider font-mono">{details.orderId}</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleDownload}
                            className="mt-8 text-center text-[#e97bfc] font-bold py-3 px-8 rounded-lg border-2 border-[#e97bfc] transition-all duration-300 ease-in-out transform hover:bg-[#e97bfc]/10 hover:shadow-lg hover:shadow-[#e97bfc]/20 active:scale-95"
                        >
                            Download Ticket
                        </button>

                        <p className="text-s text-gray-500 mt-6 text-center max-w-sm">
                            A confirmation email with your ticket will be sent to your registered email address, also keep an eye on the spam folder.
                        </p>
                    </div>
                );

            case "Pending":
                return (
                    <div className="w-full max-w-md text-center">
                        <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-yellow-400 mx-auto mb-6"></div>
                        <h1 className="text-4xl font-bold text-yellow-400 mb-4">Payment Pending</h1>
                        <p className="text-lg text-gray-300">Your payment is being processed. This can take a few moments.</p>
                        <p className="text-sm text-gray-500 mt-2">We will send a confirmation email once it&apos;s successful.</p>
                    </div>
                );

            case "Failure":
            default:
                return (
                    <div className="w-full max-w-md text-center">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-16 w-16 mx-auto mb-4 text-red-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                            />
                        </svg>
                        <h1 className="text-4xl font-bold text-red-500 mb-4">Payment Failed</h1>
                        <p className="text-lg text-gray-300">Unfortunately, your payment could not be processed.</p>
                        <Link
                            href="/"
                            className="mt-8 inline-block bg-gray-700 text-white font-bold py-3 px-6 rounded-lg text-lg hover:bg-gray-600 transition-colors duration-300"
                        >
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