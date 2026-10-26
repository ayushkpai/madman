import AsylumEscape from "@/components/asylum-escape";

export default function Home() {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-8 sm:px-6 sm:py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(127,29,29,0.28),transparent_45%),radial-gradient(circle_at_85%_80%,rgba(76,29,149,0.22),transparent_50%),linear-gradient(180deg,#07060a_0%,#0b0910_55%,#07060a_100%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.055] [background-image:repeating-linear-gradient(0deg,#fff_0px,#fff_1px,transparent_1px,transparent_4px)]"
      />
      <main className="relative z-10 flex w-full items-center justify-center">
        <AsylumEscape />
      </main>
    </div>
  );
}
