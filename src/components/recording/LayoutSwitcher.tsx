"use client";

import type { HybridLayout } from "@/types/recording";

interface LayoutSwitcherProps {
  layout: HybridLayout;
  onLayoutChange: (layout: HybridLayout) => void;
}

const layouts: { value: HybridLayout; label: string; icon: React.ReactNode }[] = [
  {
    value: "pip",
    label: "Picture-in-Picture",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <rect x="1" y="3" width="18" height="14" rx="2" fillOpacity={0.3} />
        <rect x="10" y="10" width="8" height="6" rx="1" />
      </svg>
    ),
  },
  {
    value: "side-by-side",
    label: "Lado a Lado",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <rect x="1" y="3" width="8" height="14" rx="1.5" />
        <rect x="11" y="3" width="8" height="14" rx="1.5" />
      </svg>
    ),
  },
  {
    value: "tabs",
    label: "Alternável",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <rect x="1" y="6" width="18" height="11" rx="1.5" fillOpacity={0.3} />
        <rect x="1" y="3" width="7" height="4" rx="1" />
        <rect x="9" y="3" width="7" height="4" rx="1" fillOpacity={0.4} />
      </svg>
    ),
  },
];

export const LayoutSwitcher = ({ layout, onLayoutChange }: LayoutSwitcherProps) => {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/[0.06]">
      {layouts.map((l) => (
        <button
          key={l.value}
          onClick={() => onLayoutChange(l.value)}
          aria-label={l.label}
          title={l.label}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200 ${
            layout === l.value
              ? "bg-white/15 text-white shadow-sm"
              : "text-white/30 hover:bg-white/5 hover:text-white/60"
          }`}
        >
          {l.icon}
        </button>
      ))}
    </div>
  );
};
