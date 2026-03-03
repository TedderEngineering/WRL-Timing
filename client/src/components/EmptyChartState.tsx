export default function EmptyChartState() {
  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] select-none">
      <img
        src="/te-logo-white.png"
        alt=""
        className="w-[40%] max-w-[400px] opacity-[0.08] pointer-events-none"
        draggable={false}
      />
      <p className="mt-6 text-sm text-gray-600">
        Select an event and race to begin
      </p>
    </div>
  );
}
