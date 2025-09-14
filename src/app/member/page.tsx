"use client";
import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import Image from 'next/image';

// --- Admin Login Component (same as verify/page.tsx) ---
const AdminLogin = ({
  onLogin,
  error,
  setError,
}: {
  onLogin: (user: string, pass: string) => void;
  error: string;
  setError: (err: string) => void;
}) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Username and Password are required.");
      return;
    }
    setError("");
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
        <button
          type="submit"
          className="w-full mt-6 bg-[#e97bfc] text-black font-bold py-3 px-6 rounded-lg text-lg transition-all duration-300 ease-in-out transform hover:scale-105 hover:shadow-lg hover:shadow-[#e97bfc]/50 active:scale-95"
        >
          Authenticate
        </button>
      </form>
    </div>
  );
};

// --- InputField and SelectField (copied from page.tsx) ---
interface InputFieldProps {
  label: string;
  type: string;
  placeholder: string;
  error?: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
}

const InputField: React.FC<InputFieldProps> = ({
  label,
  type,
  placeholder,
  name,
  value,
  onChange,
  required = false,
  error,
}) => {
  return (
    <div className="mb-6">
      <label htmlFor={name} className="block text-sm font-medium text-gray-300 mb-2">
        {label} {required && <span className="text-[#e97bfc]">*</span>}
      </label>
      <input
        type={type}
        id={name}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc] transition-all duration-300 autofill:!bg-white/5"
      />
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
};

interface SelectFieldProps {
  label: string;
  name: string;
  options: string[];
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  required?: boolean;
  domainStatus?: Record<string, boolean>; // <-- booleans from /api/domain-status
}

const SelectField: React.FC<SelectFieldProps> = ({ label, name, options, value, onChange, required = false, domainStatus }) => {
  return (
    <div className="mb-6">
      <label htmlFor={name} className="block text-sm font-medium text-gray-300 mb-2">
        {label} {required && <span className="text-[#e97bfc]">*</span>}
      </label>
      <select
        id={name}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-[#f8c8fc] appearance-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23f8c8fc' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
          backgroundPosition: 'right 0.5rem center',
          backgroundRepeat: 'no-repeat',
          backgroundSize: '1.5em 1.5em',
          paddingRight: '2.5rem',
        }}
      >
        <option value="" disabled>Select your option</option>
        {options.map((option) => {
          if (name === 'domain' && domainStatus) {
            const isAllowed = domainStatus[option] ?? true;
            return (
              <option
                key={option}
                value={option}
                disabled={!isAllowed}
                className="bg-[#1a0d1f] text-white disabled:text-gray-500"
              >
                {option} {!isAllowed ? '(Full)' : ''}
              </option>
            );
          }
          return (
            <option key={option} value={option} className="bg-[#1a0d1f] text-white">
              {option}
            </option>
          );
        })}
      </select>
    </div>
  );
};


// --- Member Registration Form (same fields/layout as page.tsx) ---
interface MemberFormProps {
  formData: Record<string, string>;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  errors: { email: string; phone: string };
  domainStatus: Record<string, boolean>;
}


const MemberRegistrationForm: React.FC<MemberFormProps> = ({
  formData,
  handleInputChange,
  errors,
}) => {
  const domains = ["C", "Python", "Web", "DSA", "AIML"];
  const years = ["First Year", "Second Year", "Third Year", "Fourth Year", "Fifth Year"];
  const courses = ["BTI", "BTech", "MBA Tech"];
  const departments = [
    "Computer Engineering",
    "EXTC",
    "Cybersecurity",
    "AI",
    "CSDS 311",
    "Data Science",
    "Mechanical",
    "IT",
    "Civil",
    "CSBS",
    "Mechatronics",
  ];
  const role = ["Executive", "Core"];
  const departmentACM = [
    "Content & Editorials",
    "Digital Creatives",
    "Logistics & Admin",
    "Marketing",
    "Public Relations",
    "Research & Development",
    "Technicals"
  ];

  const [domainStatus, setDomainStatus] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const fetchDomainStatus = async () => {
        try {
        const res = await fetch('/api/domain-count');
        const data = await res.json();
        if (data.success && data.registrationAllowed) {
            setDomainStatus(data.registrationAllowed);
        }
        } catch (error) {
        console.error("Error fetching domain status:", error);
        }
    };
    fetchDomainStatus();
    }, []);

  return (
    <div>
      <InputField
        label="Your Name"
        type="text"
        placeholder="Enter your full name"
        name="name"
        value={formData.name}
        onChange={handleInputChange}
        required
      />
      <InputField
        label="Your Email"
        type="email"
        placeholder="youremail@domain.com"
        name="email"
        value={formData.email}
        onChange={handleInputChange}
        required
        error={errors.email}
      />
      <InputField
        label="Contact Number"
        type="tel"
        placeholder="9876543210"
        name="contact"
        value={formData.phone}
        onChange={handleInputChange}
        required
        error={errors.phone}
      />
      <SelectField
        label="Course"
        name="course"
        options={courses}
        value={formData.course}
        onChange={handleInputChange}
        required
      />
      <SelectField
        label="Department"
        name="department"
        options={departments}
        value={formData.department}
        onChange={handleInputChange}
        required
      />
      <SelectField
        label="Current Academic Year"
        name="year"
        options={years}
        value={formData.year}
        onChange={handleInputChange}
        required
      />
      <SelectField
        label="Choose one domain to participate in"
        name="domain"
        options={domains}
        value={formData.domain}
        onChange={handleInputChange}
        required
        domainStatus={domainStatus}
      />
      <hr></hr>
      <br></br>
      <SelectField
        label="Role at ACM MPSTME"
        name="role"
        options={role}
        value={formData.role}
        onChange={handleInputChange}
        required
      />
      <SelectField
        label="Department at ACM MPSTME"
        name="departmentACM"
        options={departmentACM}
        value={formData.departmentACM}
        onChange={handleInputChange}
        required
      />
    </div>
  );
};

// --- Main Page Content ---
const MemberRegisterPageContent = () => {
  const [authCreds, setAuthCreds] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",         // changed contact -> phone
    course: "",
    department: "",
    year: "",
    domain: "",
    role: "",
    departmentACM: "",
  });
  const [formErrors, setFormErrors] = useState({ email: "", phone: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [domainStatus, setDomainStatus] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const fetchDomainStatus = async () => {
        try {
        const res = await fetch('/api/domain-count');
        const data = await res.json();
        if (data.success && data.registrationAllowed) {
            setDomainStatus(data.registrationAllowed);
        }
        } catch (error) {
        console.error("Error fetching domain status:", error);
        }
    };
    fetchDomainStatus();
    }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem("admin-creds");
    if (stored) {
      setAuthCreds(stored);
    }
  }, []);

  const handleLogin = async (user: string, pass: string) => {
    const creds = `Basic ${btoa(`${user}:${pass}`)}`;
    try {
      const res = await fetch("/api/member-login", {
        headers: { Authorization: creds },
      });
      if (!res.ok) {
        setError("Invalid username or password");
        return;
      }
      sessionStorage.setItem("admin-creds", creds);
      setAuthCreds(creds);
      setError("");
    } catch {
      setError("Network error during authentication");
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (name === "email" || name === "phone") {
      setFormErrors(prev => ({ ...prev, [name]: "" }));
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^[6-9]\d{9}$/;
    let isValid = true;
    const errors = { email: "", phone: "", domain: "" };
    if (!emailRegex.test(formData.email)) {
      errors.email = "Please enter a valid email address.";
      isValid = false;
    }
    if (!phoneRegex.test(formData.phone)) {
      errors.phone = "Please enter a valid 10-digit mobile number.";
      isValid = false;
    }
    setFormErrors(errors);
    if (!isValid) return;

    setIsLoading(true);
    setSuccessMsg("");

    try {
      const res = await fetch("/api/member-register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authCreds!,
        },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Member registration failed.");
      }
      setSuccessMsg("Member registered successfully!");
      // clear form
      setFormData({
        name: "",
        email: "",
        phone: "",
        course: "",
        department: "",
        year: "",
        domain: "",
        role: "",
        departmentACM: "",
      });
    } catch (err: any) {
      alert(err.message || "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  
  if (!authCreds) {
      return <AdminLogin onLogin={handleLogin} error={error} setError={setError} />;
  }

  return (
    <div className="relative w-full max-w-3xl bg-black/30 backdrop-blur-md rounded-2xl border border-white/10">
      <div className="p-8 sm:p-10 md:p-12">
        <div className="flex items-center justify-center mb-10">
          <header className="text-center mb-10">
                {/* <h1 className="text-4xl font-extrabold text-white mb-2">
                  Programming For Everyone
                </h1> */}
                <div className="flex items-center justify-center">
                  <Image
                    src={"/pfelogo.png"}
                    alt="Registration QR Code"
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
        </div>

        <form onSubmit={handleSubmit}>
          <MemberRegistrationForm
            formData={formData}
            handleInputChange={handleInputChange}
            errors={formErrors}
            domainStatus={domainStatus}
          />

          <div className="mt-10 text-center">
            {successMsg && (
              <p className="mb-4 text-green-400 font-semibold">{successMsg}</p>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full max-w-xs mx-auto bg-[#e97bfc] text-white font-bold py-3 px-6 rounded-lg text-lg transition-all duration-300 ease-in-out transform hover:scale-105 hover:shadow-2xl hover:shadow-[#e97bfc]/50 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "Registering..." : "Register Member"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// --- Main Page Component ---
export default function MemberRegisterPage() {
  return (
    <main className="min-h-screen text-white font-sans flex items-center justify-center p-4 sm:p-6 md:p-8">
      <Suspense fallback={<div className="text-2xl text-white">Loading...</div>}>
        <MemberRegisterPageContent />
      </Suspense>
    </main>
  );
}
