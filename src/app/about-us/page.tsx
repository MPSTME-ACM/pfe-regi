import Link from "next/link";
import PixelBlast from "@/components/PixelBlast/PixelBlast";
export default function AboutUsPage() {
  return (
    <div className="min-h-screen text-foreground font-sans p-8 sm:p-12 md:p-16 flex flex-col justify-center">
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
        className="!absolute inset-0 w-full h-full !-z-10 opacity-20"
      />
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-extrabold text-primary mb-8">
          Get to Know Us!
        </h1>
        <div className="space-y-6 text-muted-foreground text-lg">
          <p>
            The{" "}
            <span className="font-semibold text-primary">
              ACM Student Chapter at MPSTME
            </span>{" "}
            aims to ignite passion in young minds for technology and foster
            innovation. We conduct workshops, hackathons, podcasts, and blogs
            while offering members opportunities to excel in their fields
            through projects. Our goal is to empower youth to master computing
            and coding, gaining a technological edge. We provide high-quality
            education and open doors to new opportunities.
          </p>
          <p>
            Since our inception, we have been actively engaged in fostering a
            culture of learning and innovation. We are the leading student
            committee for consumers of all things tech, from competitive
            programming and web development to AI/ML and cybersecurity.
          </p>
          <p>
            At present, our events and workshops are open to students across
            India. We focus on helping our members by providing high-quality
            workshops, proper learning resources, and extremely competitive
            hackathons and coding contests.
          </p>
          <p>
            Bound by our love for coding, ACM combines competition and
            collaboration, reaching milestones yearly with a growing team of
            bright minds. Join us as we explore the fascinating world of coding!
          </p>
        </div>
        <div className="mt-12">
          <Link
            href="/"
            className="text-primary hover:text-primary/80 transition-colors"
          >
            &larr; Back to Registration
          </Link>
        </div>
      </div>
    </div>
  );
}
