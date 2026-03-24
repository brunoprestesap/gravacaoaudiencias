"use client";

import { useRef, useEffect } from "react";
import { AUDIO_LEVEL } from "@/lib/constants";

interface AudioLevelIndicatorProps {
  levelRef: React.MutableRefObject<number>;
  active: boolean;
}

export function AudioLevelIndicator({ levelRef, active }: AudioLevelIndicatorProps) {
  const barsRef = useRef<HTMLSpanElement[]>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;

    const stopLoop = () => {
      alive = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      barsRef.current.forEach((bar, i) => {
        if (bar) bar.style.height = `${i === 2 ? 30 : 20}%`;
      });
    };

    if (!active) {
      stopLoop();
      return;
    }

    const tick = () => {
      if (!alive) return;

      const level = levelRef.current;

      barsRef.current.forEach((bar, i) => {
        if (!bar) return;
        const sensitivity = AUDIO_LEVEL.BAR_SENSITIVITY_BASE + i * AUDIO_LEVEL.BAR_SENSITIVITY_STEP;
        const h = Math.max(AUDIO_LEVEL.BAR_MIN_HEIGHT, Math.min(1, level * sensitivity));
        bar.style.height = `${Math.round(h * 100)}%`;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return stopLoop;
  }, [active, levelRef]);

  return (
    <div
      className="flex items-center gap-1.5"
      title={active ? "Captando áudio" : "Áudio inativo"}
      aria-label={active ? "Indicador de nível de áudio — captando" : "Indicador de áudio inativo"}
    >
      <svg
        className={`h-3.5 w-3.5 shrink-0 transition-colors duration-300 ${active ? "text-emerald-400" : "text-white/20"}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
        />
      </svg>

      <div className="flex h-4 items-end gap-[2px]">
        {Array.from({ length: AUDIO_LEVEL.BAR_COUNT }).map((_, i) => (
          <span
            key={i}
            ref={(el) => { if (el) barsRef.current[i] = el; }}
            className={`w-[3px] rounded-full transition-colors duration-300 ${
              active ? "bg-emerald-400" : "bg-white/15"
            }`}
            style={{
              height: `${i === 2 ? 30 : 20}%`,
              transition: active
                ? "height 80ms ease-out, background-color 300ms"
                : "background-color 300ms",
            }}
          />
        ))}
      </div>
    </div>
  );
}
