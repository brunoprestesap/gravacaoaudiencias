"use client";

import type { MultiCameraLayout } from "@/types/recording";

interface MultiCameraLayoutSwitcherProps {
  layout: MultiCameraLayout;
  onLayoutChange: (layout: MultiCameraLayout) => void;
  cameraCount: number;
}

const layouts: {
  value: MultiCameraLayout;
  label: string;
  minCameras: number;
  icon: React.ReactNode;
}[] = [
  {
    value: "side-by-side",
    label: "Lado a Lado",
    minCameras: 2,
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <rect x="1" y="3" width="8" height="14" rx="1.5" />
        <rect x="11" y="3" width="8" height="14" rx="1.5" />
      </svg>
    ),
  },
  {
    value: "stacked",
    label: "Empilhado",
    minCameras: 2,
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <rect x="1" y="2" width="18" height="7" rx="1.5" />
        <rect x="1" y="11" width="18" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    value: "grid",
    label: "Grade",
    minCameras: 3,
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <rect x="1" y="1" width="8" height="8" rx="1.5" />
        <rect x="11" y="1" width="8" height="8" rx="1.5" />
        <rect x="1" y="11" width="8" height="8" rx="1.5" />
        <rect x="11" y="11" width="8" height="8" rx="1.5" />
      </svg>
    ),
  },
  {
    value: "main-pip",
    label: "Principal + PiP",
    minCameras: 2,
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <rect x="1" y="2" width="18" height="16" rx="1.5" fillOpacity={0.3} />
        <rect x="11" y="11" width="7" height="5" rx="1" />
      </svg>
    ),
  },
];

export const MultiCameraLayoutSwitcher = ({
  layout,
  onLayoutChange,
  cameraCount,
}: MultiCameraLayoutSwitcherProps) => {
  const available = layouts.filter((l) => l.minCameras <= cameraCount);

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-white/30">
        Layout Câmeras
      </span>
      <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/[0.06]">
        {available.map((l) => (
          <button
            key={l.value}
            onClick={() => onLayoutChange(l.value)}
            aria-label={l.label}
            title={l.label}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200 ${
              layout === l.value
                ? "bg-violet-500/25 text-violet-200 shadow-sm ring-1 ring-violet-500/30"
                : "text-white/30 hover:bg-white/5 hover:text-white/60"
            }`}
          >
            {l.icon}
          </button>
        ))}
      </div>
    </div>
  );
};
