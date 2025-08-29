
"use client";
import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

interface CashfreeSDK {
  checkout(options: { paymentSessionId: string; redirectTarget: string; }): void;
}

// Component: ParticleBackground
const ParticleBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    const characters = 'ACM MPSTME PFE PYTHON WEBDEV DSA AIML WORKSHOP CODING 2025';
    const fontSize = 16;
    
    let columns: number;
    let drops: { y: number; char: string }[];
    let content: { text: string; y: number }[];

    const draw = () => {
      if (!ctx || !canvas || !drops) return;

      ctx.fillStyle = 'rgba(13, 13, 26, 0.1)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.fillStyle = '#e97bfc';
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < columns; i++) {
        const drop = drops[i];
        if(drop) {
          ctx.fillText(drop.char, i * fontSize, drop.y * fontSize);
        }
      }
    };

    const initialize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      columns = Math.floor(canvas.width / fontSize);
      drops = [];
      for (let i = 0; i < columns; i++) {
        drops[i] = {
          y: Math.floor(Math.random() * (canvas.height / fontSize)),
          char: characters.charAt(Math.floor(Math.random() * characters.length)),
        };
      }
      content = [
        { text: 'ACM MPSTME', y: canvas.height * 0.3 },
        { text: 'PYTHON WORKSHOP 2025', y: canvas.height * 0.5 },
        { text: 'CODING WEBDEV DSA AIML', y: canvas.height * 0.7 },
      ];
      
      draw();
    };

    let resizeTimeout: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        initialize();
      }, 250);
    };

    let frameCount = 0;
    const speedInterval = 5;

    const update = () => {
      for (let i = 0; i < columns; i++) {
        const drop = drops[i];
        if(!drop) continue;

        if (drop.y * fontSize > canvas.height && Math.random() > 0.995) {
          drop.y = 0;
        } else {
          drop.y++;
        }

        const nextYPos = drop.y * fontSize;
        let nextChar = characters.charAt(Math.floor(Math.random() * characters.length));

        for (const line of content) {
          const sentenceY = line.y;
          const sentenceText = line.text;
          const revealRange = fontSize;
          const textStartIndex = Math.floor((columns - sentenceText.length) / 2);
          const textEndIndex = textStartIndex + sentenceText.length;
          const charIndexInSentence = i - textStartIndex;

          if (i >= textStartIndex && i < textEndIndex) {
            if (nextYPos > sentenceY && nextYPos < sentenceY + revealRange) {
              nextChar = sentenceText.charAt(charIndexInSentence);
            }
          }
        }
        drop.char = nextChar;
      }
    };

    const animate = () => {
      draw();
      if (frameCount % speedInterval === 0) {
        update();
      }
      frameCount++;
      animationFrameId = window.requestAnimationFrame(animate);
    };

    window.addEventListener('resize', handleResize);
    initialize();
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.cancelAnimationFrame(animationFrameId);
      clearTimeout(resizeTimeout);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, left: 0, zIndex: -1, width: '100vw', height: '100vh' }} />;
};


// Component: Header
const Header = () => {
  return (
    <header className="text-center mb-10">
      <h1 className="text-4xl font-extrabold text-white mb-2">
        Programming For Everyone
      </h1>
      <p className="text-xl text-gray-300">
        A 3-day workshop by <span className="font-semibold text-[#d358f2]">ACM MPSTME</span>
      </p>
      <p className="text-md text-gray-500 mt-2">
        September 16th - 18th, 2025
      </p>
    </header>
  );
};

// Component: InputField
interface InputFieldProps {
  label: string;
  type: string;
  placeholder: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
}

const InputField: React.FC<InputFieldProps> = ({ label, type, placeholder, name, value, onChange, required = false }) => {
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
        className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc] transition-all duration-300"
      />
    </div>
  );
};

// Component: SelectField
interface SelectFieldProps {
  label: string;
  name: string;
  options: string[];
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  required?: boolean;
}

const SelectField: React.FC<SelectFieldProps> = ({ label, name, options, value, onChange, required = false }) => {
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
        {options.map((option) => (
          <option key={option} value={option} className="bg-[#1a0d1f] text-white">
            {option}
          </option>
        ))}
      </select>
    </div>
  );
};

// Component: RegistrationForm
interface RegistrationFormProps {
  formData: Record<string, string>;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
}
const RegistrationForm: React.FC<RegistrationFormProps> = ({ formData, handleInputChange }) => {
  const domains = ['C', 'Python', 'Web', 'DSA', 'AIML'];
  const years = ['First Year', 'Second Year', 'Third Year', 'Fourth Year', 'Fifth Year'];
  const courses = ['BTI', 'BTech', 'MBA Tech'];
  const departments = [
    'Computer Engineering', 'EXTC', 'Cybersecurity', 'AI', 'CSDS 311',
    'Data Science', 'Mechanical', 'IT', 'Civil', 'CSBS', 'Mechatronics'
  ];

  return (
    <div>
      <InputField label="Your Name" type="text" placeholder="Enter your full name" name="name" value={formData.name} onChange={handleInputChange} required />
      <InputField label="Your Email" type="email" placeholder="youremail@domain.com" name="email" value={formData.email} onChange={handleInputChange} required />
      <InputField label="Contact Number" type="tel" placeholder="9876543210" name="contact" value={formData.contact} onChange={handleInputChange} required />
      <SelectField label="Course" name="course" options={courses} value={formData.course} onChange={handleInputChange} required />
      <SelectField label="Department" name="department" options={departments} value={formData.department} onChange={handleInputChange} required />
      <SelectField label="Current Academic Year" name="year" options={years} value={formData.year} onChange={handleInputChange} required />
      <SelectField label="Choose one domain to participate in" name="domain" options={domains} value={formData.domain} onChange={handleInputChange} required />
    </div>
  );
};


// Main Page Component
export default function Home() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    contact: '',
    course: '',
    department: '',
    year: '',
    domain: '',
  });
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [cashfree, setCashfree] = useState<CashfreeSDK | null>(null);
  const [paymentSessionId, setPaymentSessionId] = useState<string | null>(null);
  const [merchantName, setMerchantName] = useState('');
  const [merchantEmail, setMerchantEmail] = useState('');

  useEffect(() => {
    setMerchantName(process.env.NEXT_PUBLIC_MERCHANT_NAME || 'ACM MPSTME');
    setMerchantEmail(process.env.NEXT_PUBLIC_MERCHANT_EMAIL || 'pfe@mpst.me');
  }, []); // The empty dependency array ensures this runs only once.

  useEffect(() => {
    const initializeSDK = async () => {
      // Dynamically import the package only on the client-side
      const { load } = await import("@cashfreepayments/cashfree-js");
      const cf = await load({
        mode: process.env.CASHFREE_ENV! // Dyanmic input thru .env
      });
      setCashfree(cf);
    };
    initializeSDK();
  }, []);

  const totalFields = Object.keys(formData).length;

  useEffect(() => {
    const filledFields = Object.values(formData).filter(value => value !== '').length;
    setProgress((filledFields / totalFields) * 100);
  }, [formData, totalFields]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!cashfree) {
      console.error("Cashfree SDK not initialized yet.");
      return;
    }
    setIsLoading(true);

    try {
      const response = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (data.success && data.payment_session_id) {
        setPaymentSessionId(data.payment_session_id);
        // The checkout will be rendered in a useEffect hook when paymentSessionId is set
      } else {
        console.error('Failed to create order:', data.message);
        setIsLoading(false);
      }
    } catch (error) {
      console.error('An error occurred:', error);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (paymentSessionId && cashfree) {
      const checkoutOptions = {
        paymentSessionId: paymentSessionId,
        redirectTarget: "_modal", // Use "_self" to render in the same container
      };
      cashfree.checkout(checkoutOptions);
      setIsLoading(false); // Stop loading once checkout is rendered
    }
  }, [paymentSessionId, cashfree]);

  const headPosition = progress;
  const bodyPosition = Math.max(0, progress - 1);


  return (
    <>
      <style jsx global>{`
        html, body {
            background-color: transparent !important;
        }
        .progress-glow-container {
            position: relative;
            padding: 2px;
        }
        .progress-glow-container::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            border-radius: 18px;
            padding: 2px;
            background: conic-gradient(from 0deg at 50% 50%, #e97bfc 0%, #e97bfc ${bodyPosition}%, #f8c8fc ${headPosition}%, transparent ${headPosition}%, transparent 100%);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
            z-index: -1;
            transition: background 0.8s cubic-bezier(0.25, 1, 0.5, 1);
        }
      `}</style>
      <main className="min-h-screen text-white font-sans flex items-center justify-center p-4 sm:p-6 md:p-8 bg-transparent">
        <ParticleBackground />
        <div className="w-full max-w-3xl bg-black/50 backdrop-blur-md rounded-2xl border border-white/10 progress-glow-container">
          <div className="p-8 sm:p-10 md:p-12">
            <Header />
            {!paymentSessionId ? (
              <form onSubmit={handleSubmit}>
                <RegistrationForm formData={formData} handleInputChange={handleInputChange} />
                <div className="mt-10 text-center">
                  <div className="">
                    <p className="mb-2 text-2xl font-bold text-white">Ticket Price: ₹99</p>
                    {merchantName && (
                      <p className="mb-2 text-sm text-gray-500">
                        You will be securely redirected to our payment partner to complete your payment to{' '}
                        <Link
                          href={`mailto:${merchantEmail}`}
                          className="relative group font-medium text-gray-400 hover:text-[#e97bfc] transition-colors"
                        >
                          {merchantName}
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max px-2 py-1 bg-black text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                            {merchantEmail}
                          </span>
                        </Link>.
                      </p>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full max-w-xs mx-auto bg-[#e97bfc] text-black font-bold py-3 px-6 rounded-lg text-lg transition-all duration-300 ease-in-out transform hover:scale-105 hover:shadow-2xl hover:shadow-[#e97bfc]/50 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Processing...' : 'Proceed to Pay'}
                  </button>
                </div>
              </form>
            ) : (
              <div id="cf_checkout" className="w-full"></div>
            )}

            <div className="mt-8 text-center text-sm text-gray-500">
              <p>By registering, you agree to our policies.</p>
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
              </div>
            </div>
          </div>
        </div>


      </main>
    </>
  );
}
