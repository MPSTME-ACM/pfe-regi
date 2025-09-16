"use client";
import React from 'react';
import Link from 'next/link';
import Image from 'next/image';

// Component: Header
const Header = () => {
  return (
    <header className="text-center mb-10">
      <div className="flex items-center justify-center">
        <Image
          src={"/pfelogo.png"}
          alt="Programming for Everyone Logo"
          width={1235}
          height={727}
          className="p-1 rounded-lg w-74"
        />
      </div>
      <div className="max-w-full text-center px-4">
        <p className="text-xl text-gray-300">
          A 3-day workshop by{" "}
          <span className="whitespace-nowrap font-semibold text-[#f8c8fc]">
            ACM MPSTME
          </span>
        </p>
      </div>
      <p className="text-md text-gray-500 mt-2">
        September 16th - 18th, 2025
      </p>
    </header>
  );
};

// Component: ContactInfo
const ContactInfo = () => {
  const contactDetails = [
      { name: 'Rutvi Mandowara', phone: '8000106729'},
      { name: 'Kartik Jain', phone: '8169133253'},
  ];

  return (
    <div className="mt-8 text-center">
      <h2 className="text-2xl font-bold text-white mb-4">Contact Information</h2>
      <div className="flex flex-col sm:flex-row justify-center gap-6">
        {contactDetails.map((contact, index) => (
          <div key={index} className="bg-white/5 border border-white/20 p-6 rounded-lg text-left w-full sm:w-1/2 max-w-sm mx-auto">
            <h3 className="text-lg font-semibold text-[#e97bfc] mb-2">{contact.name}</h3>
            <p className="text-gray-300">
              <span className="font-medium">Phone:</span>{" "}
              <Link href={`tel:+91${contact.phone}`} className="hover:text-white transition-colors">
                {contact.phone}
              </Link>
            </p>
            {/* <p className="text-gray-300">
              <span className="font-medium">Email:</span>{" "}
              <Link href={`mailto:${contact.email}`} className="hover:text-white transition-colors break-words">
                {contact.email}
              </Link>
            </p> */}
          </div>
        ))}
      </div>
    </div>
  );
};

// Main Page Component
export default function Home() {
  return (
    <main className="min-h-screen text-white font-sans flex items-center justify-center p-4 sm:p-6 md:p-8">
      <div className="w-full max-w-3xl bg-black/30 backdrop-blur-md rounded-2xl border border-white/10 p-8 sm:p-10 md:p-12">
        <Header />
        <div className="text-center mt-10 mb-8">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-[#f8c8fc] mb-4 leading-tight">
            Form Closed
          </h1>
          <p className="text-xl text-gray-300">
            Thank you for your interest!
          </p>
        </div>
        <ContactInfo />
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>We appreciate your interest in our workshop.</p>
          <div className="flex justify-center gap-x-4 mt-2">
            <Link href="/terms-of-service" className="hover:text-[#f8c8fc] transition-colors">
              Terms of Service
            </Link>
            <span>&bull;</span>
            <Link href="/cancellation-policy" className="hover:text-[#f8c8fc] transition-colors">
              Our Policies
            </Link>
            <span>&bull;</span>
            <Link href="/about-us" className="hover:text-[#f8c8fc] transition-colors">
              About Us
            </Link>
            <span>&bull;</span>
            <Link href="/contact-us" className="hover:text-[#f8c8fc] transition-colors">
              Contact Us
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}