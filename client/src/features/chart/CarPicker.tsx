import { useState, useMemo, useRef, useEffect } from "react";
import type { RaceChartData } from "@shared/types";

interface CarPickerProps {
  data: RaceChartData;
  focusNum: number;
  selectedNum: number | null;
  onSelect: (carNum: number) => void;
}

export function CarPicker({ data, focusNum, selectedNum, onSelect }: CarPickerProps) {
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("All");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const classes = useMemo(() => {
    const cls = Object.keys(data.classGroups).sort();
    return ["All", ...cls];
  }, [data.classGroups]);

  const cars = useMemo(() => {
    const all = Object.entries(data.cars)
      .map(([k, c]) => ({ num: parseInt(k, 10), team: c.team, cls: c.cls }))
      .filter((c) => c.num !== focusNum);

    return all.filter((c) => {
      if (classFilter !== "All" && c.cls !== classFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return String(c.num).includes(q) || c.team.toLowerCase().includes(q);
      }
      return true;
    }).sort((a, b) => a.num - b.num);
  }, [data.cars, focusNum, search, classFilter]);

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-3 pt-3 pb-2">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search car # or team..."
          className="w-full px-2.5 py-1.5 rounded-md text-xs bg-white/[0.06] border border-white/[0.1] text-white placeholder:text-white/30 outline-none focus:border-white/25"
        />
      </div>

      {/* Class filter pills */}
      <div className="flex gap-1 px-3 pb-2 flex-wrap">
        {classes.map((cls) => (
          <button
            key={cls}
            onClick={() => setClassFilter(cls)}
            className="px-2 py-0.5 rounded-full text-[10px] border cursor-pointer transition-colors"
            style={{
              background: classFilter === cls ? "rgba(99,102,241,0.2)" : "transparent",
              borderColor: classFilter === cls ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.1)",
              color: classFilter === cls ? "#a5b4fc" : "rgba(255,255,255,0.4)",
            }}
          >
            {cls}
          </button>
        ))}
      </div>

      {/* Car list */}
      <div className="flex-1 overflow-y-auto px-1" style={{ scrollbarWidth: "none" }}>
        {cars.map((c) => {
          const isSelected = c.num === selectedNum;
          return (
            <button
              key={c.num}
              onClick={() => onSelect(c.num)}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 rounded-md cursor-pointer transition-colors"
              style={{
                background: isSelected ? "rgba(99,102,241,0.15)" : "transparent",
              }}
            >
              <span className="font-mono font-bold text-xs" style={{ color: isSelected ? "#818cf8" : "rgba(255,255,255,0.7)" }}>
                #{c.num}
              </span>
              <span className="text-[11px] truncate flex-1" style={{ color: "rgba(255,255,255,0.45)" }}>
                {c.team}
              </span>
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                {c.cls}
              </span>
              {isSelected && <span className="text-[11px]" style={{ color: "#818cf8" }}>✓</span>}
            </button>
          );
        })}
        {cars.length === 0 && (
          <div className="text-center py-4 text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
            No cars match
          </div>
        )}
      </div>
    </div>
  );
}
