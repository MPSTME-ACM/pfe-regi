"use client";

const Background = () => {
  return (
    <>
      <style jsx global>{`
        @keyframes gradient-animation {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animated-gradient {
          background: linear-gradient(-45deg, #ffffff1a, #1a0d1f, #0d0d1a, #1a0d1f);
          background-size: 400% 400%;
          animation: gradient-animation 15s ease infinite;
        }
      `}</style>
      <div className="fixed top-0 left-0 w-full h-full -z-10 animated-gradient" />
    </>
  );
};

export default Background;