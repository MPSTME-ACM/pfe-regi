"use client";
import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PixelBlast from "@/components/PixelBlast/PixelBlast"; 

interface CashfreeSDK {
  checkout(options: { paymentSessionId: string; redirectTarget: string }): void;
}

export default function Home() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    contact: "",
    course: "",
    department: "",
    year: "",
    domain: "",
  });
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [cashfree, setCashfree] = useState<CashfreeSDK | null>(null);
  const [paymentSessionId, setPaymentSessionId] = useState<string | null>(null);
  const [merchantName, setMerchantName] = useState("");
  const [merchantEmail, setMerchantEmail] = useState("");

  useEffect(() => {
    setMerchantName(process.env.NEXT_PUBLIC_MERCHANT_NAME || "ACM MPSTME");
    setMerchantEmail(process.env.NEXT_PUBLIC_MERCHANT_EMAIL || "pfe@mpst.me");
  }, []);

  useEffect(() => {
    const initializeSDK = async () => {
      const { load } = await import("@cashfreepayments/cashfree-js");
      const cf = await load({ mode: "production" });
      setCashfree(cf);
    };
    initializeSDK();
  }, []);

  const totalFields = Object.keys(formData).length;

  useEffect(() => {
    const filledFields = Object.values(formData).filter((v) => v !== "").length;
    setProgress((filledFields / totalFields) * 100);
  }, [formData, totalFields]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!cashfree) {
      console.error("Cashfree SDK not initialized yet.");
      return;
    }
    setIsLoading(true);

    try {
      const response = await fetch("/api/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (data.success && data.payment_session_id) {
        setPaymentSessionId(data.payment_session_id);
      } else {
        console.error("Failed to create order:", data.message);
        setIsLoading(false);
      }
    } catch (error) {
      console.error("An error occurred:", error);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (paymentSessionId && cashfree) {
      cashfree.checkout({
        paymentSessionId,
        redirectTarget: "_modal",
      });
      setIsLoading(false);
    }
  }, [paymentSessionId, cashfree]);

  return (
    <>
      <main className="relative min-h-screen flex flex-col md:flex-row overflow-hidden">
        <div className="md:w-1/2 w-full h-screen relative">
          <PixelBlast
            variant="circle"
            pixelSize={6}
            color="#B19EEF"
            patternScale={3}
            patternDensity={1.2}
            pixelSizeJitter={0.5}
            enableRipples
            rippleSpeed={0.4}
            rippleThickness={0.12}
            rippleIntensityScale={1.5}
            liquid
            liquidStrength={0.12}
            liquidRadius={1.2}
            liquidWobbleSpeed={5}
            speed={0.6}
            edgeFade={0.25}
            transparent
            className="!absolute inset-0 w-full h-full !-z-10 md:opacity-100 opacity-40"
          />
        </div>{" "}
        <div className="mt-[-100vh] md:mt-0 md:w-1/2 w-full flex items-center justify-center p-6 text-white">
          <div className="w-full max-w-md p-6 rounded-2xl space-y-6">
            <h1 className="text-2xl font-bold text-left text-white">
              Programming For Everyone
            </h1>
            <p className="text-left text-white/80">
              A 3-day Programming workshop
            </p>
            <p className="text-left text-sm text-white/50">
              September 16th - 18th, 2025
            </p>

            {!paymentSessionId ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Name */}
                <div className="space-y-1">
                  <Label htmlFor="name" className="text-white">
                    Name
                  </Label>
                  <Input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    required
                    className=""
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="email" className="text-white">
                    Email
                  </Label>
                  <Input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    className=""
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="contact" className="text-white">
                    Contact
                  </Label>
                  <Input
                    type="tel"
                    id="contact"
                    name="contact"
                    value={formData.contact}
                    onChange={handleInputChange}
                    required
                    className=""
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-white">Course</Label>
                  <Select
                    onValueChange={(v) => handleSelectChange("course", v)}
                    value={formData.course}
                  >
                    <SelectTrigger className="">
                      <SelectValue placeholder="Select course" />
                    </SelectTrigger>
                    <SelectContent className="">
                      <SelectItem value="BTI">BTI</SelectItem>
                      <SelectItem value="BTech">BTech</SelectItem>
                      <SelectItem value="MBA Tech">MBA Tech</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-white">Department</Label>
                  <Select
                    onValueChange={(v) => handleSelectChange("department", v)}
                    value={formData.department}
                  >
                    <SelectTrigger className="">
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent className=" max-h-60 overflow-y-auto">
                      <SelectItem value="Computer Engineering">
                        Computer Engineering
                      </SelectItem>
                      <SelectItem value="EXTC">EXTC</SelectItem>
                      <SelectItem value="Cybersecurity">
                        Cybersecurity
                      </SelectItem>
                      <SelectItem value="AI">AI</SelectItem>
                      <SelectItem value="CSDS 311">CSDS 311</SelectItem>
                      <SelectItem value="Data Science">Data Science</SelectItem>
                      <SelectItem value="Mechanical">Mechanical</SelectItem>
                      <SelectItem value="IT">IT</SelectItem>
                      <SelectItem value="Civil">Civil</SelectItem>
                      <SelectItem value="CSBS">CSBS</SelectItem>
                      <SelectItem value="Mechatronics">Mechatronics</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-white">Year</Label>
                  <Select
                    onValueChange={(v) => handleSelectChange("year", v)}
                    value={formData.year}
                  >
                    <SelectTrigger className="">
                      <SelectValue placeholder="Select year" />
                    </SelectTrigger>
                    <SelectContent className="">
                      <SelectItem value="First Year">First Year</SelectItem>
                      <SelectItem value="Second Year">Second Year</SelectItem>
                      <SelectItem value="Third Year">Third Year</SelectItem>
                      <SelectItem value="Fourth Year">Fourth Year</SelectItem>
                      <SelectItem value="Fifth Year">Fifth Year</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-white">Domain</Label>
                  <Select
                    onValueChange={(v) => handleSelectChange("domain", v)}
                    value={formData.domain}
                  >
                    <SelectTrigger className="">
                      <SelectValue placeholder="Select domain" />
                    </SelectTrigger>
                    <SelectContent className="">
                      <SelectItem value="C">C</SelectItem>
                      <SelectItem value="Python">Python</SelectItem>
                      <SelectItem value="Web">Web</SelectItem>
                      <SelectItem value="DSA">DSA</SelectItem>
                      <SelectItem value="AIML">AIML</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <p className="text-left text-white/70 text-sm">
                  Progress: {progress.toFixed(0)}%
                </p>

                <div className="flex justify-start">
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className=" px-6 py-3 hover:bg-white/30 transition-all"
                  >
                    {isLoading ? "Processing..." : "Proceed to Pay"}
                  </Button>
                </div>
              </form>
            ) : (
              <div id="cf_checkout"></div>
            )}

            <div className="text-left text-xs text-white/70">
              <p>By registering, you agree to our policies.</p>
              <a href="/terms-of-service" className="hover:underline">
                Terms of Service
              </a>{" "}
              |{" "}
              <a href="/cancellation-policy" className="hover:underline">
                Our Policies
              </a>{" "}
              |{" "}
              <a href="/about-us" className="hover:underline">
                About Us
              </a>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
