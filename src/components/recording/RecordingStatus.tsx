"use client";

import type { RecordingStatus as RecordingStatusType } from "@/types/recording";

interface RecordingStatusProps {
  status: RecordingStatusType;
  elapsedMs: number;
  chunkCount: number;
  totalBytes: number;
}

const formatTime = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const statusConfig: Record<RecordingStatusType, { label: string; dotClass: string; badgeClass: string }> = {
  idle: {
    label: "PRONTO",
    dotClass: "bg-white/30",
    badgeClass: "bg-white/5 text-white/50 ring-white/10",
  },
  recording: {
    label: "REC",
    dotClass: "animate-pulse-rec bg-red-500",
    badgeClass: "bg-red-500/10 text-red-400 ring-red-500/20",
  },
  paused: {
    label: "PAUSADO",
    dotClass: "bg-amber-400",
    badgeClass: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
  },
  stopped: {
    label: "ENCERRADO",
    dotClass: "bg-white/30",
    badgeClass: "bg-white/5 text-white/50 ring-white/10",
  },
};

export const RecordingStatus = ({
  status,
  elapsedMs,
  chunkCount,
  totalBytes,
}: RecordingStatusProps) => {
  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-4">
      {/* Status badge */}
      <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 ring-1 ${config.badgeClass}`}>
        <span className={`inline-block h-2 w-2 rounded-full ${config.dotClass}`} />
        <span className="text-[11px] font-bold uppercase tracking-wider">
          {config.label}
        </span>
      </div>

      {/* Timer */}
      <div className="rounded-lg bg-white/5 px-3 py-1.5 ring-1 ring-white/[0.06]">
        <span className="font-mono text-base font-bold tabular-nums text-white">
          {formatTime(elapsedMs)}
        </span>
      </div>

      {/* Storage info - compact */}
      <div className="hidden items-center gap-1.5 text-[11px] text-white/40 sm:flex">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
          />
        </svg>
        <span>{chunkCount}</span>
        <span className="text-white/20">|</span>
        <span>{formatBytes(totalBytes)}</span>
      </div>
    </div>
  );
};
