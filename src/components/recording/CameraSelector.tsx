"use client";

import type { DetectedDevice } from "@/hooks/useDeviceDetection";

interface CameraSelectorProps {
  cameras: DetectedDevice[];
  selectedCameras: string[];
  onToggle: (deviceId: string) => void;
  disabled?: boolean;
}

export const CameraSelector = ({
  cameras,
  selectedCameras,
  onToggle,
  disabled = false,
}: CameraSelectorProps) => {
  if (cameras.length <= 1) return null;

  return (
    <div>
      <h3 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-white/40">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
        Câmeras
        {selectedCameras.length > 1 && (
          <span className="ml-auto rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold text-violet-300 ring-1 ring-violet-500/30">
            {selectedCameras.length} ativas
          </span>
        )}
      </h3>

      <div className="space-y-1.5">
        {cameras.map((cam, index) => {
          const isSelected = selectedCameras.includes(cam.deviceId);
          const isLast = selectedCameras.length === 1 && isSelected;
          return (
            <button
              key={cam.deviceId}
              onClick={() => !disabled && onToggle(cam.deviceId)}
              disabled={disabled || isLast}
              title={isLast ? "Pelo menos uma câmera deve estar ativa" : undefined}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-all ${
                isSelected
                  ? "bg-violet-500/15 text-white ring-1 ring-violet-500/25"
                  : "text-white/40 hover:bg-white/5 hover:text-white/60"
              } ${disabled || isLast ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            >
              {/* Checkbox */}
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                isSelected ? "border-violet-400 bg-violet-500/30" : "border-white/20 bg-white/5"
              }`}>
                {isSelected && (
                  <svg className="h-2.5 w-2.5 text-violet-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                )}
              </span>

              {/* Camera icon + label */}
              <span className="truncate font-medium">
                {cam.label || `Câmera ${index + 1}`}
              </span>

              {isSelected && selectedCameras.length > 1 && (
                <span className="ml-auto shrink-0 rounded bg-white/10 px-1.5 text-[10px] text-white/50">
                  #{selectedCameras.indexOf(cam.deviceId) + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedCameras.length > 1 && (
        <p className="mt-2 text-[10px] text-white/25">
          Arraste para reordenar · Layout ajustável durante a gravação
        </p>
      )}
    </div>
  );
};
