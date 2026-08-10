import ProgramHeader from '@/app/_components/ProgramHeader';
import PolicyLinks from '@/app/_components/PolicyLinks';
import BackToRegistration from '@/app/_components/BackToRegistration';

export default function AboutUsPage() {
  const dateRange = 'September 16th - 18th, 2025';

  return (
    <main className="min-h-screen text-white font-sans flex flex-col items-center justify-center p-4 sm:p-6 md:p-8">
      <div className="mb-4 w-full max-w-3xl">
        <BackToRegistration />
      </div>
      <div className="w-full max-w-3xl bg-black/30 backdrop-blur-md rounded-2xl border border-white/10 p-8 sm:p-10 md:p-12">
        <ProgramHeader dateRange={dateRange} />

        <div className="text-center mt-10 mb-8">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-accent-soft mb-4 leading-tight">
            Get to Know Us!
          </h1>
        </div>

        <div className="max-w-prose mx-auto space-y-6 text-gray-300 leading-relaxed">
          <p>The <span className="font-semibold text-accent-soft">ACM Student Chapter at MPSTME</span> aims to ignite passion in young minds for technology and foster innovation. We conduct workshops, hackathons, podcasts, and blogs while offering members opportunities to excel in their fields through projects. Our goal is to empower youth to master computing and coding, gaining a technological edge. We provide high-quality education and open doors to new opportunities.</p>
          <p>Since our inception, we have been actively engaged in fostering a culture of learning and innovation. We are the leading student committee for consumers of all things tech, from competitive programming and web development to AI/ML and cybersecurity.</p>
          <p>At present, our events and workshops are open to students across the globe. We focus on helping our members by providing high-quality workshops, proper learning resources, and extremely competitive hackathons and coding contests.</p>
          <p>Bound by our love for tech, ACM combines competition and collaboration, reaching milestones yearly with a growing team of bright minds. Join us as we explore the fascinating world of computing!</p>
        </div>

        <PolicyLinks note="We appreciate your interest in our workshop." />
      </div>
    </main>
  );
}