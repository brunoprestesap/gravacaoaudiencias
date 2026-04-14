"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  inferSpeakerRoleFromText,
  type SpeakerRole,
  type VoiceFeatures,
} from "@/lib/transcription-diarization";
import type { ProcessMetadata } from "@/types/recording";

export interface SpeechSegment {
  id: string;
  text: string;
  offsetMs: number;
  createdAt: string;
  speakerId?: string;
  role?: SpeakerRole;
  confidence?: number;
  voiceFeatures?: VoiceFeatures;
}

interface UseSpeechRecognitionOptions {
  lang?: string;
  processMetadata?: ProcessMetadata;
  getVoiceFeatures?: () => VoiceFeatures | undefined;
  onError?: (message: string) => void;
}

interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface BrowserWithWebkitSpeech extends Window {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

const randomId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const useSpeechRecognition = ({
  lang = "pt-BR",
  processMetadata,
  getVoiceFeatures,
  onError,
}: UseSpeechRecognitionOptions = {}) => {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onErrorRef = useRef<UseSpeechRecognitionOptions["onError"]>(onError);
  const shouldRunRef = useRef(false);
  const isStartingRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  const pauseStartedAtRef = useRef<number | null>(null);
  const totalPausedMsRef = useRef(0);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSupported =
    typeof window !== "undefined"
    && Boolean(
      (window as BrowserWithWebkitSpeech).webkitSpeechRecognition
      || (window as BrowserWithWebkitSpeech).SpeechRecognition
    );

  const unsupportedReason = (() => {
    if (typeof window === "undefined") return null;
    if (isSupported) return null;
    const ua = navigator.userAgent;
    if (/Firefox/i.test(ua)) return "O Firefox não suporta transcrição em tempo real. Use o Google Chrome ou Microsoft Edge.";
    if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return "O Safari não suporta transcrição em tempo real. Use o Google Chrome ou Microsoft Edge.";
    return "Seu navegador não suporta transcrição em tempo real (Web Speech API). Use o Google Chrome ou Microsoft Edge.";
  })();

  const [isRunning, setIsRunning] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [finalSegments, setFinalSegments] = useState<SpeechSegment[]>([]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const browserWindow = window as BrowserWithWebkitSpeech;
    const ctor = browserWindow.webkitSpeechRecognition ?? browserWindow.SpeechRecognition;
    if (!ctor) return;

    const recognition = new ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (event) => {
      let currentInterim = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript?.trim();
        if (!transcript) continue;

        if (result.isFinal) {
          const startedAt = startedAtRef.current ?? Date.now();
          const offsetMs = Math.max(0, Date.now() - startedAt - totalPausedMsRef.current);
          const inference = inferSpeakerRoleFromText(transcript, processMetadata);
          const segment: SpeechSegment = {
            id: randomId(),
            text: transcript,
            offsetMs,
            createdAt: new Date().toISOString(),
            role: inference.role,
            confidence: inference.confidence,
            voiceFeatures: getVoiceFeatures?.(),
          };
          setFinalSegments((prev) => [...prev, segment]);
        } else {
          currentInterim += `${transcript} `;
        }
      }

      setInterimText(currentInterim.trim());
    };

    recognition.onerror = (event) => {
      const code = event.error ?? "unknown";
      if (code === "aborted") return;
      onErrorRef.current?.(`Falha na transcrição em tempo real (${code}).`);
    };

    recognition.onend = () => {
      setIsRunning(false);
      if (!shouldRunRef.current) return;

      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
      }
      restartTimerRef.current = setTimeout(() => {
        try {
          isStartingRef.current = true;
          recognition.start();
          isStartingRef.current = false;
          setIsRunning(true);
        } catch {
          isStartingRef.current = false;
        }
      }, 250);
    };

    recognitionRef.current = recognition;

    return () => {
      shouldRunRef.current = false;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      try {
        recognition.stop();
      } catch {
        // ignore cleanup failure
      }
      recognitionRef.current = null;
    };
  }, [lang, processMetadata, getVoiceFeatures]);

  const resetSession = useCallback(() => {
    setInterimText("");
    setFinalSegments([]);
    startedAtRef.current = Date.now();
    pauseStartedAtRef.current = null;
    totalPausedMsRef.current = 0;
  }, []);

  const start = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || !isSupported) return false;
    if (isStartingRef.current || shouldRunRef.current) return true;

    resetSession();
    shouldRunRef.current = true;

    try {
      isStartingRef.current = true;
      recognition.start();
      isStartingRef.current = false;
      setIsRunning(true);
      return true;
    } catch {
      isStartingRef.current = false;
      shouldRunRef.current = false;
      setIsRunning(false);
      onErrorRef.current?.("Não foi possível iniciar a transcrição em tempo real.");
      return false;
    }
  }, [isSupported, resetSession]);

  const pause = useCallback(() => {
    if (!shouldRunRef.current) return;
    shouldRunRef.current = false;
    pauseStartedAtRef.current = Date.now();
    setInterimText("");
    try {
      recognitionRef.current?.stop();
    } catch {
      // no-op
    }
  }, []);

  const resume = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || !isSupported || shouldRunRef.current) return;

    if (pauseStartedAtRef.current) {
      totalPausedMsRef.current += Date.now() - pauseStartedAtRef.current;
      pauseStartedAtRef.current = null;
    }

    shouldRunRef.current = true;
    try {
      isStartingRef.current = true;
      recognition.start();
      isStartingRef.current = false;
      setIsRunning(true);
    } catch {
      isStartingRef.current = false;
      shouldRunRef.current = false;
      setIsRunning(false);
      onErrorRef.current?.("Não foi possível retomar a transcrição em tempo real.");
    }
  }, [isSupported]);

  const stop = useCallback(() => {
    shouldRunRef.current = false;
    setInterimText("");
    pauseStartedAtRef.current = null;
    try {
      recognitionRef.current?.stop();
    } catch {
      // no-op
    }
  }, []);

  const removeSegmentsByIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setFinalSegments((prev) => prev.filter((segment) => !idSet.has(segment.id)));
  }, []);

  const transcriptText = useMemo(
    () => finalSegments.map((segment) => segment.text).join(" ").trim(),
    [finalSegments]
  );

  return {
    isSupported,
    unsupportedReason,
    isRunning,
    interimText,
    finalSegments,
    transcriptText,
    start,
    pause,
    resume,
    stop,
    removeSegmentsByIds,
  };
};
