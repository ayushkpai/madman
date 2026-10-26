import RoadHunt from "@/components/road-hunt";

export default function Home() {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-8 sm:px-6 sm:py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(255,196,110,0.2),transparent_50%),radial-gradient(circle_at_85%_90%,rgba(120,60,20,0.25),transparent_55%),linear-gradient(180deg,#120d08_0%,#171009_55%,#0c0906_100%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:repeating-linear-gradient(0deg,#fff_0px,#fff_1px,transparent_1px,transparent_4px)]"
      />
      <main className="relative z-10 flex w-full items-center justify-center">
        <RoadHunt />
      </main>
    </div>
  );
}
