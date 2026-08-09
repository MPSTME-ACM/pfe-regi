import Link from 'next/link';
import PolicyLinks from './PolicyLinks';
import ProgramHeader from './ProgramHeader';
import type { EventConfig } from '@/lib/db/schema';

// Shown when settings.registrationOpen is false. The heading and body are
// editable from /admin — previously this whole page was swapped in by renaming
// page.save.tsx and committing.

const CONTACTS = [
  { name: 'Rutvi Mandowara', phone: '8000106729' },
  { name: 'Kartik Jain', phone: '8169133253' },
];

export default function ClosedNotice({
  title,
  body,
  eventConfig,
}: {
  title: string;
  body: string;
  eventConfig: EventConfig;
}) {
  return (
    <main className="min-h-screen text-white font-sans flex items-center justify-center p-4 sm:p-6 md:p-8">
      <div className="w-full max-w-3xl bg-black/30 backdrop-blur-md rounded-2xl border border-white/10 p-8 sm:p-10 md:p-12">
        <ProgramHeader dateRange={eventConfig.dateRange} />

        <div className="text-center mt-10 mb-8">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-[#f8c8fc] mb-4 leading-tight">
            {title}
          </h1>
          {/* Author-entered copy. Rendered as text, never as HTML. */}
          <p className="text-xl text-gray-300 whitespace-pre-line">{body}</p>
        </div>

        <div className="mt-8 text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Contact Information</h2>
          <div className="flex flex-col sm:flex-row justify-center gap-6">
            {CONTACTS.map((contact) => (
              <div
                key={contact.phone}
                className="bg-white/5 border border-white/20 p-6 rounded-lg text-left w-full sm:w-1/2 max-w-sm mx-auto"
              >
                <h3 className="text-lg font-semibold text-[#e97bfc] mb-2">{contact.name}</h3>
                <p className="text-gray-300">
                  <span className="font-medium">Phone:</span>{' '}
                  <Link href={`tel:+91${contact.phone}`} className="hover:text-white transition-colors">
                    {contact.phone}
                  </Link>
                </p>
              </div>
            ))}
          </div>
        </div>

        <PolicyLinks note="We appreciate your interest in our workshop." />
      </div>
    </main>
  );
}
