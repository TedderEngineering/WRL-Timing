import { useRef } from "react";
import { cn } from "../lib/utils";

interface SearchBarProps {
  value: string;
  onChange: (q: string) => void;
  isSearching: boolean;
  className?: string;
}

export function SearchBar({ value, onChange, isSearching, className }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={cn("relative", className)}>
      {/* Search icon / spinner */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
        {isSearching ? (
          <div className="h-4 w-4 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />
        ) : (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        )}
      </div>

      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search tracks, series, races..."
        className="w-full h-10 md:h-10 pl-10 pr-9 rounded-lg border border-gray-700 bg-gray-800 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
      />

      {/* Clear button */}
      {value && (
        <button
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors"
          aria-label="Clear search"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
