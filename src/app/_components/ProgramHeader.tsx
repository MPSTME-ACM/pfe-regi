import Image from 'next/image';

// Logo + tagline + date range. Identical in the open and closed states, so it
// lives here rather than being kept in sync by hand. Presentational only, so
// it works in both a server and a client component.

export default function ProgramHeader({ dateRange }: { dateRange: string }) {
  return (
    <header className="mb-10 text-center">
      <div className="flex items-center justify-center">
        <Image
          src="/pfelogo.png"
          alt="Programming for Everyone"
          width={1235}
          height={727}
          className="w-74 rounded-lg p-1"
          priority
        />
      </div>
      <p className="text-xl text-balance text-gray-300">
        A technical learning program by{' '}
        <span className="font-semibold whitespace-nowrap text-accent-soft">ACM MPSTME</span>
      </p>
      <p className="mt-2 text-base text-gray-500">{dateRange}</p>
    </header>
  );
}
