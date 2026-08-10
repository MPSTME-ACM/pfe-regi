"use client";
import React, { useEffect, useState, Suspense, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { toJpeg } from "html-to-image";
import PolicyLinks from "@/app/_components/PolicyLinks";

/**
 * Exactly what /api/get-status returns — an unauthenticated endpoint, so this is
 * a deliberately small whitelist and not the registration row.
 *
 * 2026 replaced the single `domain` with a SKU plus up to three tracks, so the
 * ticket now shows a resolved `description` ("Python + Capstone Day"). A 2025
 * ticket resolves from the read-only archive and says so.
 */
interface RegistrationDetails {
    edition: 2025 | 2026;
    name: string;
    description: string;
    sku: string | null;
    course: string | null;
    year: string | null;
    orderId: string;
    qrCodeUrl: string | null;
}

/**
 * The SKU names the buyer chose from, so the ticket calls the purchase what the
 * form called it. Mirrors `COPY` in _components/SkuChooser (not exported there);
 * if those titles change, change these.
 *
 * The per-track DATES are deliberately absent: /api/get-status whitelists
 * `description` and `sku` and does not return `days`, so the ticket cannot state
 * a date without inventing one.
 */
const SKU_LABEL: Record<string, string> = {
    capstone: "Capstone Day",
    single: "One Track",
    bundle: "Full Bundle",
};

// --- Icons -------------------------------------------------------------------
// Status is never carried by colour alone: every state pairs its hue with one of
// these marks and with wording that says the same thing.

const iconBase = "h-7 w-7";

const CheckIcon = () => (
    <svg className={iconBase} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.5l5 5 10-11" />
    </svg>
);

const ClockIcon = () => (
    <svg className={iconBase} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
        <circle cx="12" cy="12" r="8.75" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5.4l3.4 2" />
    </svg>
);

const CrossIcon = () => (
    <svg className={iconBase} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 7l10 10M17 7L7 17" />
    </svg>
);

const Spinner = () => (
    <span
        className="block h-8 w-8 rounded-full border-[3px] border-white/15 border-t-accent animate-spin [animation-duration:0.9s] motion-reduce:animate-none"
        aria-hidden="true"
    />
);

// --- Shared shells -----------------------------------------------------------

/** The wordmark, shown on every state except Success — where the ticket carries
 *  its own masthead and a second logo would just be repetition. */
const PageMark = () => (
    <div className="mb-7 text-center">
        <Image
            src="/pfelogo.png"
            alt="Programming for Everyone"
            width={1235}
            height={727}
            className="mx-auto w-36 h-auto"
            priority
        />
    </div>
);

type Tone = "working" | "paid" | "pending" | "failed";

const TONE: Record<Tone, { ring: string; text: string; heading: string }> = {
    working: { ring: "border-accent/35 bg-accent/10", text: "text-accent", heading: "text-accent-soft" },
    paid: { ring: "border-emerald-400/40 bg-emerald-400/10", text: "text-emerald-300", heading: "text-emerald-200" },
    pending: { ring: "border-amber-400/40 bg-amber-400/10", text: "text-amber-300", heading: "text-amber-200" },
    failed: { ring: "border-rose-400/40 bg-rose-400/10", text: "text-rose-300", heading: "text-rose-200" },
};

/**
 * Every non-ticket outcome. One shape, so the page does not appear to change
 * layout between "still checking" and "done" — only the mark, the hue and the
 * words change.
 */
const StatusCard = ({
    tone,
    icon,
    title,
    lead,
    children,
}: {
    tone: Tone;
    icon: React.ReactNode;
    title: string;
    lead: string;
    children?: React.ReactNode;
}) => {
    const t = TONE[tone];
    return (
        <div className="bg-black/30 backdrop-blur-md rounded-2xl border border-white/10 p-8 sm:p-10 text-center">
            <span
                className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full border ${t.ring} ${t.text}`}
            >
                {icon}
            </span>
            <h1 className={`mt-6 text-2xl sm:text-3xl font-bold leading-tight ${t.heading}`}>{title}</h1>
            <p className="mt-3 text-gray-300 text-balance">{lead}</p>
            {children}
        </div>
    );
};

/** The order id, in the one place support will ask for it. */
const OrderRef = ({ orderId }: { orderId: string }) => (
    <div className="mt-7 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-500">Order ID</p>
        <p className="mt-1 font-mono text-sm tracking-wide text-gray-200 break-all">{orderId}</p>
    </div>
);

const StatusDisplay = () => {
    const [status, setStatus] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [details, setDetails] = useState<RegistrationDetails | null>(null);
    const [hasRetried, setHasRetried] = useState(false);
    /** Mirrored from the query string so failure and pending can still quote it. */
    const [orderRef, setOrderRef] = useState<string>("");
    /** The node handed to html-to-image: the padded ticket, and nothing else. */
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

        setOrderRef(orderId);
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
            // No forced canvas size: the node is captured at its own dimensions,
            // so the file is the ticket rather than the ticket adrift in a large
            // empty rectangle. `backgroundColor` only shows through the rounded
            // corners of the padded wrapper.
            toJpeg(wrapperRef.current, {
                cacheBust: true,
                backgroundColor: "#0b0710",
                quality: 1.0,
                pixelRatio: 3,
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
                <>
                    <PageMark />
                    <StatusCard
                        tone="working"
                        icon={<Spinner />}
                        title="Checking your payment"
                        lead="Please keep this page open."
                    />
                </>
            );
        }

        switch (status) {
            case "Success":
                // The gateway confirmed the payment but the registration could not
                // be resolved. Previously this rendered nothing at all — a blank
                // screen immediately after paying.
                if (!details) {
                    return (
                        <>
                            <PageMark />
                            <StatusCard
                                tone="paid"
                                icon={<CheckIcon />}
                                title="Payment received"
                                lead="The payment gateway confirmed your payment. We could not load your ticket on this screen — quote this order ID if you need help."
                            >
                                {orderRef && <OrderRef orderId={orderRef} />}
                            </StatusCard>
                        </>
                    );
                }

                if (!details.qrCodeUrl) {
                    return (
                        <>
                            <PageMark />
                            <StatusCard
                                tone="paid"
                                icon={<CheckIcon />}
                                title="Payment successful"
                                lead="Your payment is successful. We are generating your ticket. Please wait a moment."
                            >
                                <p className="mt-6 flex items-center justify-center gap-3 text-sm text-gray-400">
                                    <Spinner />
                                    Preparing your QR code
                                </p>
                                {/* gray-400, not the muted gray-500: this is the line
                                    that stops a double charge. */}
                                <p className="mt-5 text-sm text-gray-400 text-balance">
                                    Your payment is already confirmed. Do not pay again.
                                </p>
                                {orderRef && <OrderRef orderId={orderRef} />}
                            </StatusCard>
                        </>
                    );
                }

                return (
                    <div className="animate-fade-in">
                        <div className="mb-6 flex items-center justify-center gap-2.5 text-emerald-300">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/10">
                                <svg
                                    className="h-4 w-4"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={3}
                                    aria-hidden="true"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.5l5 5 10-11" />
                                </svg>
                            </span>
                            {/* The page's one h1 is the outcome, not the name on the
                                ticket: it is what a screen reader should announce
                                on arrival. Size carries the ticket's hierarchy. */}
                            <h1 className="text-lg font-bold tracking-wide">Payment successful</h1>
                        </div>

                        {/* The captured node. Opaque throughout: html-to-image
                            serialises to an SVG foreignObject, where backdrop-filter
                            does not render — a translucent ticket would export as
                            something the buyer never saw. */}
                        <div ref={wrapperRef} className="rounded-[22px] bg-[#0b0710] p-4">
                            <div className="overflow-hidden rounded-2xl border border-accent/30 bg-[#150d1b]">
                                <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#1d1226] px-5 py-3.5">
                                    <Image
                                        src="/pfelogo.png"
                                        alt="Programming for Everyone"
                                        width={1235}
                                        height={727}
                                        className="h-7 w-auto"
                                        priority
                                    />
                                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent-soft">
                                        Entry ticket
                                    </span>
                                </div>

                                {/* The QR is the object of the whole page: white
                                    quiet zone, no tint over it, nothing beside it. */}
                                <div className="px-5 pt-7 pb-6">
                                    <div className="mx-auto w-fit rounded-2xl bg-white p-3">
                                        <Image
                                            src={details.qrCodeUrl}
                                            alt="Registration QR code"
                                            width={512}
                                            height={512}
                                            className="block h-52 w-52 sm:h-56 sm:w-56"
                                            quality={100}
                                        />
                                    </div>
                                    <p className="mt-4 text-center text-[11px] font-medium uppercase tracking-[0.18em] text-gray-500">
                                        Show this at the door
                                    </p>
                                </div>

                                {/* Perforation. A dashed rule, not cut-out circles:
                                    the circles were painted in a fixed colour that
                                    never matched the animated page behind them, so
                                    they read as blobs stuck to the edges. */}
                                <div className="mx-5 border-t border-dashed border-white/20" />

                                <div className="px-5 pt-5 pb-6 text-center">
                                    <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-gray-500">
                                        Attendee
                                    </p>
                                    <p className="mt-1.5 text-2xl font-bold leading-tight text-white break-words">
                                        {details.name}
                                    </p>
                                    <p className="mt-2 text-lg font-medium leading-snug text-accent-soft text-balance">
                                        {details.description}
                                    </p>

                                    <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2">
                                        {details.sku && SKU_LABEL[details.sku] && (
                                            <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent-soft">
                                                {SKU_LABEL[details.sku]}
                                            </span>
                                        )}
                                        {details.edition === 2025 && (
                                            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-semibold tracking-wide text-amber-300">
                                                PFE 2025 &middot; archived
                                            </span>
                                        )}
                                    </div>

                                    {(details.course || details.year) && (
                                        <p className="mt-3.5 text-sm text-gray-400">
                                            {[details.course, details.year].filter(Boolean).join(" • ")}
                                        </p>
                                    )}

                                    <div className="mt-5 border-t border-white/10 pt-4">
                                        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-gray-500">
                                            Order ID
                                        </p>
                                        <p className="mt-1 font-mono text-sm tracking-wide text-gray-200 break-all">
                                            {details.orderId}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleDownload}
                            className="mt-7 w-full rounded-lg bg-accent px-6 py-3.5 text-lg font-bold text-black transition-[transform,box-shadow] duration-200 ease-out hover:shadow-lg hover:shadow-accent/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.99]"
                        >
                            Download Ticket
                        </button>

                        <p className="mt-5 text-center text-sm text-gray-500 text-balance">
                            A confirmation email with your ticket will be sent to your registered email address,
                            also keep an eye on the spam folder.
                        </p>
                    </div>
                );

            case "Pending":
                return (
                    <>
                        <PageMark />
                        <StatusCard
                            tone="pending"
                            icon={<ClockIcon />}
                            title="Payment pending"
                            lead="Your payment is being processed. This can take a few moments."
                        >
                            <p className="mt-4 text-sm text-gray-400 text-balance">
                                We will send a confirmation email once it&apos;s successful. Do not pay again while
                                this is pending.
                            </p>
                            {orderRef && <OrderRef orderId={orderRef} />}
                        </StatusCard>
                    </>
                );

            case "Failure":
            default:
                return (
                    <>
                        <PageMark />
                        <StatusCard
                            tone="failed"
                            icon={<CrossIcon />}
                            title="Payment failed"
                            lead="Unfortunately, your payment could not be processed."
                        >
                            {orderRef && <OrderRef orderId={orderRef} />}
                            <Link
                                href="/"
                                className="mt-7 block w-full rounded-lg bg-accent px-6 py-3.5 text-lg font-bold text-black transition-[transform,box-shadow] duration-200 ease-out hover:shadow-lg hover:shadow-accent/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.99]"
                            >
                                Try Again
                            </Link>
                        </StatusCard>
                    </>
                );
        }
    };

    return (
        <div aria-live="polite" aria-busy={loading}>
            {renderStatus()}
        </div>
    );
};

export default function PaymentStatusPage() {
    return (
        // No opaque backdrop and no second gradient wash: layout.tsx renders the
        // animated <Background /> behind every page, and the old absolutely
        // positioned gradient here just competed with it.
        <main className="min-h-screen text-white font-sans flex items-center justify-center p-4 sm:p-6 md:p-8">
            <div className="w-full max-w-md">
                <Suspense
                    fallback={
                        <>
                            <PageMark />
                            <StatusCard
                                tone="working"
                                icon={<Spinner />}
                                title="Checking your payment"
                                lead="Please keep this page open."
                            />
                        </>
                    }
                >
                    <StatusDisplay />
                </Suspense>
                <PolicyLinks note="Need help with your registration? Our contact details are below." />
            </div>
        </main>
    );
}
