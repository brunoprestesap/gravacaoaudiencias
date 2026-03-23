"use client";

import type { RecordingStatus } from "@/types/recording";

interface RecordingControlsProps {
  status: RecordingStatus;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

// SVG Icons
const PlayIcon = () => (
  <svg className="ml-0.5 h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const PauseIcon = () => (
  <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);

const StopIcon = () => (
  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const RecordIcon = () => (
  <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="7" />
  </svg>
);

export const RecordingControls = ({
  status,
  onStart,
  onPause,
  onResume,
  onStop,
}: RecordingControlsProps) => {
  return (
    <div className="flex items-center gap-3">
      {status === "idle" && (
        <ControlButton
          label="Iniciar Gravação"
          icon={<RecordIcon />}
          variant="record"
          onClick={onStart}
          size="lg"
        />
      )}

      {status === "recording" && (
        <>
          <ControlButton
            label="Pausar"
            icon={<PauseIcon />}
            variant="warning"
            onClick={onPause}
          />
          <ControlButton
            label="Encerrar"
            icon={<StopIcon />}
            variant="neutral"
            onClick={onStop}
          />
        </>
      )}

      {status === "paused" && (
        <>
          <ControlButton
            label="Retomar"
            icon={<PlayIcon />}
            variant="success"
            onClick={onResume}
          />
          <ControlButton
            label="Encerrar"
            icon={<StopIcon />}
            variant="neutral"
            onClick={onStop}
          />
        </>
      )}

      {status === "stopped" && (
        <ControlButton
          label="Iniciar Nova Gravação"
          icon={<RecordIcon />}
          variant="record"
          onClick={onStart}
          size="lg"
        />
      )}
    </div>
  );
};

type ButtonVariant = "record" | "warning" | "success" | "neutral";

const variantStyles: Record<ButtonVariant, string> = {
  record: "bg-gradient-to-b from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25 hover:from-red-400 hover:to-red-500 hover:shadow-red-500/40 active:from-red-600 active:to-red-700 focus-visible:ring-red-500/50",
  warning: "bg-gradient-to-b from-amber-500 to-amber-600 text-white shadow-lg shadow-amber-500/25 hover:from-amber-400 hover:to-amber-500 hover:shadow-amber-500/40 active:from-amber-600 active:to-amber-700 focus-visible:ring-amber-500/50",
  success: "bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-400 hover:to-emerald-500 hover:shadow-emerald-500/40 active:from-emerald-600 active:to-emerald-700 focus-visible:ring-emerald-500/50",
  neutral: "bg-gradient-to-b from-white/15 to-white/10 text-white/80 shadow-lg shadow-black/10 ring-1 ring-white/10 hover:from-white/20 hover:to-white/15 hover:text-white active:from-white/10 active:to-white/5 focus-visible:ring-white/30",
};

const ControlButton = ({
  label,
  icon,
  variant,
  onClick,
  size = "md",
  disabled = false,
}: {
  label: string;
  icon: React.ReactNode;
  variant: ButtonVariant;
  onClick: () => void;
  size?: "md" | "lg";
  disabled?: boolean;
}) => {
  const sizeClasses = size === "lg" ? "h-16 w-16" : "h-14 w-14";

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        onClick={onClick}
        disabled={disabled}
        title={label}
        className={`recording-btn flex items-center justify-center rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:opacity-40 disabled:cursor-not-allowed ${sizeClasses} ${variantStyles[variant]}`}
      >
        {icon}
      </button>
      <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">
        {label.split(" ")[0]}
      </span>
    </div>
  );
};
