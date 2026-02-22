import { useEffect, useRef } from "react";

/**
 * An animated mini lap chart for the landing page hero.
 * Pure SVG with CSS animations — no charting library needed.
 */

interface CarTrace {
  color: string;
  label: string;
  positions: number[]; // position at each "lap"
}

const CARS: CarTrace[] = [
  { color: "#ef4444", label: "#12", positions: [1, 1, 1, 2, 2, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1] },
  { color: "#3b82f6", label: "#07", positions: [3, 3, 2, 1, 1, 1, 1, 2, 3, 3, 2, 1, 2, 2, 2] },
  { color: "#f59e0b", label: "#34", positions: [2, 2, 3, 3, 4, 2, 2, 3, 2, 2, 3, 3, 3, 3, 3] },
  { color: "#10b981", label: "#51", positions: [5, 4, 4, 4, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4] },
  { color: "#8b5cf6", label: "#88", positions: [4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5] },
  { color: "#ec4899", label: "#22", positions: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6] },
];

const LAPS = CARS[0].positions.length;
const CHART_W = 520;
const CHART_H = 200;
const PADDING_L = 36;
const PADDING_R = 36;
const PADDING_T = 12;
const PADDING_B = 12;
const PLOT_W = CHART_W - PADDING_L - PADDING_R;
const PLOT_H = CHART_H - PADDING_T - PADDING_B;
const MAX_POS = 6;

function posToY(pos: number): number {
  return PADDING_T + ((pos - 1) / (MAX_POS - 1)) * PLOT_H;
}

function lapToX(lap: number): number {
  return PADDING_L + (lap / (LAPS - 1)) * PLOT_W;
}

function buildPath(positions: number[]): string {
  return positions
    .map((pos, i) => {
      const x = lapToX(i);
      const y = posToY(pos);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

export function HeroChart() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    // Trigger animation after mount
    const paths = svgRef.current?.querySelectorAll<SVGPathElement>(".trace-path");
    paths?.forEach((path, i) => {
      const length = path.getTotalLength();
      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = `${length}`;
      path.style.animation = `drawLine 2s ease-out ${i * 0.1}s forwards`;
    });
  }, []);

  return (
    <div className="relative">
      <style>{`
        @keyframes drawLine {
          to { stroke-dashoffset: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .trace-label {
          opacity: 0;
          animation: fadeIn 0.4s ease-out 2.2s forwards;
        }
      `}</style>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid lines */}
        {Array.from({ length: MAX_POS }, (_, i) => {
          const y = posToY(i + 1);
          return (
            <g key={i}>
              <line
                x1={PADDING_L}
                y1={y}
                x2={CHART_W - PADDING_R}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={1}
              />
              <text
                x={PADDING_L - 8}
                y={y + 4}
                textAnchor="end"
                className="text-[10px] fill-gray-600"
                fontFamily="monospace"
              >
                P{i + 1}
              </text>
            </g>
          );
        })}

        {/* Vertical lap markers */}
        {Array.from({ length: LAPS }, (_, i) => {
          if (i === 0 || i === LAPS - 1 || i % 3 === 0) {
            const x = lapToX(i);
            return (
              <g key={`v${i}`}>
                <line
                  x1={x}
                  y1={PADDING_T}
                  x2={x}
                  y2={CHART_H - PADDING_B}
                  stroke="rgba(255,255,255,0.04)"
                  strokeWidth={1}
                />
              </g>
            );
          }
          return null;
        })}

        {/* Car traces */}
        {CARS.map((car) => (
          <path
            key={car.label}
            className="trace-path"
            d={buildPath(car.positions)}
            fill="none"
            stroke={car.color}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* End labels */}
        {CARS.map((car) => {
          const lastPos = car.positions[car.positions.length - 1];
          const x = lapToX(LAPS - 1) + 6;
          const y = posToY(lastPos) + 3.5;
          return (
            <text
              key={`lbl-${car.label}`}
              x={x}
              y={y}
              className="trace-label text-[9px] font-bold"
              fill={car.color}
              fontFamily="monospace"
            >
              {car.label}
            </text>
          );
        })}
      </svg>

      {/* Bottom axis label */}
      <div className="flex justify-between px-9 -mt-1">
        <span className="text-[10px] text-gray-600 font-mono">Lap 1</span>
        <span className="text-[10px] text-gray-600 font-mono">Lap {LAPS}</span>
      </div>
    </div>
  );
}
