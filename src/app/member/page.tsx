"use client";
import React from 'react';
import Link from 'next/link';
import ProgramHeader from '@/app/_components/ProgramHeader';
import PolicyLinks from '@/app/_components/PolicyLinks';

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
  const dateRange = 'September 16th - 18th, 2025';

  return (
    <main className="min-h-screen text-white font-sans flex items-center justify-center p-4 sm:p-6 md:p-8">
      <div className="w-full max-w-3xl bg-black/30 backdrop-blur-md rounded-2xl border border-white/10 p-8 sm:p-10 md:p-12">
        <ProgramHeader dateRange={dateRange} />
        <div className="text-center mt-10 mb-8">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-[#f8c8fc] mb-4 leading-tight">
            Form Closed
          </h1>
          <p className="text-xl text-gray-300">
            Thank you for your interest!
          </p>
        </div>
        <ContactInfo />
        <PolicyLinks note="We appreciate your interest in our workshop." />
      </div>
    </main>
  );
}