"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

interface VideoPreviewProps {
  stream: MediaStream | null;
  mirrored?: boolean;
  isLoading?: boolean;
}

const subscribeToClient = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export const VideoPreview = ({ stream, mirrored = false, isLoading = false }: VideoPreviewProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mounted = useSyncExternalStore(subscribeToClient, getClientSnapshot, getServerSnapshot);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream) {
      video.srcObject = stream;
    } else {
      video.srcObject = null;
    }
  }, [stream]);

  const showLoading = mounted && isLoading;

  return (
    <div className="video-preview-container relative h-full w-full overflow-hidden rounded-2xl bg-black/60 ring-1 ring-white/[0.08]">
      {/* Subtle gradient border effect */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/[0.04] to-transparent" />

      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`h-full w-full object-contain ${mirrored ? "scale-x-[-1]" : ""}`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="text-center">
            {showLoading ? (
              <div className="flex flex-col items-center gap-4">
                {/* Animated rings loader */}
                <div className="relative h-16 w-16">
                  <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-blue-400" style={{ animationDuration: "1.2s" }} />
                  <div className="absolute inset-2 animate-spin rounded-full border-[3px] border-transparent border-t-indigo-400" style={{ animationDuration: "0.8s", animationDirection: "reverse" }} />
                  <div className="absolute inset-4 animate-spin rounded-full border-[3px] border-transparent border-t-violet-400" style={{ animationDuration: "1.5s" }} />
                </div>
                <div>
                  <p className="text-sm font-medium text-white/70">Conectando câmera</p>
                  <p className="mt-0.5 text-xs text-white/30">Aguarde a inicialização do dispositivo...</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                {/* Camera placeholder icon with glow */}
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-blue-500/10 blur-xl" />
                  <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-white/[0.04] ring-1 ring-white/[0.06]">
                    <svg
                      className="h-10 w-10 text-white/20"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
                      />
                    </svg>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-white/50">Câmera não conectada</p>
                  <p className="mt-0.5 text-xs text-white/25">Selecione um dispositivo para iniciar</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
