// @vitest-environment jsdom

import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDeviceDetection } from "./useDeviceDetection";

type MediaDeviceInfoLike = {
  deviceId: string;
  kind: MediaDeviceKind;
  label: string;
};

const makeStream = () => {
  const stop1 = vi.fn();
  const stop2 = vi.fn();
  return {
    getTracks: () => [{ stop: stop1 }, { stop: stop2 }],
    stop1,
    stop2,
  };
};

let enumerateDevices: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;
let deviceChangeHandlers: Array<() => void>;
let lastTempStream: ReturnType<typeof makeStream>;

const installNavigatorMediaDevices = (devices: MediaDeviceInfoLike[]) => {
  enumerateDevices = vi.fn().mockResolvedValue(devices);
  getUserMedia = vi.fn().mockImplementation(async () => {
    lastTempStream = makeStream();
    return lastTempStream;
  });
  deviceChangeHandlers = [];

  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    writable: true,
    value: {
      getUserMedia,
      enumerateDevices,
      addEventListener: vi.fn((_ev: string, cb: () => void) => {
        deviceChangeHandlers.push(cb);
      }),
      removeEventListener: vi.fn((_ev: string, cb: () => void) => {
        deviceChangeHandlers = deviceChangeHandlers.filter((h) => h !== cb);
      }),
    },
  });
};

describe("useDeviceDetection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    try {
      Reflect.deleteProperty(globalThis.navigator, "mediaDevices");
    } catch {
      Object.defineProperty(globalThis.navigator, "mediaDevices", {
        configurable: true,
        value: undefined,
      });
    }
  });

  it("detecta dispositivos após solicitar permissão e encerra o stream temporário", async () => {
    installNavigatorMediaDevices([
      { deviceId: "cam-a", kind: "videoinput", label: "Câmera integrada" },
      { deviceId: "mic-a", kind: "audioinput", label: "Microfone interno" },
    ]);

    const { result } = renderHook(() => useDeviceDetection(true));

    await waitFor(() => expect(result.current.isDetecting).toBe(false));

    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
    expect(lastTempStream.stop1).toHaveBeenCalled();
    expect(lastTempStream.stop2).toHaveBeenCalled();

    expect(result.current.cameras).toHaveLength(1);
    expect(result.current.microphones).toHaveLength(1);
    expect(result.current.selectedCamera).toBe("cam-a");
    expect(result.current.selectedMicrophone).toBe("mic-a");
    expect(result.current.error).toBeNull();
  });

  it("prefere câmera Logitech quando há várias opções", async () => {
    installNavigatorMediaDevices([
      { deviceId: "cam-generic", kind: "videoinput", label: "Webcam genérica" },
      { deviceId: "cam-logi", kind: "videoinput", label: "Logitech BRIO" },
      { deviceId: "mic-1", kind: "audioinput", label: "Microfone padrão" },
    ]);

    const { result } = renderHook(() => useDeviceDetection(true));

    await waitFor(() => expect(result.current.isDetecting).toBe(false));

    expect(result.current.selectedCamera).toBe("cam-logi");
    expect(result.current.selectedCameras).toEqual(["cam-logi"]);
  });

  it("prefere microfone USB externo em relação a rótulos genéricos", async () => {
    installNavigatorMediaDevices([
      { deviceId: "cam-1", kind: "videoinput", label: "Câmera" },
      { deviceId: "mic-logi", kind: "audioinput", label: "Logitech headset" },
      { deviceId: "mic-usb", kind: "audioinput", label: "USB Condenser Mic" },
    ]);

    const { result } = renderHook(() => useDeviceDetection(true));

    await waitFor(() => expect(result.current.isDetecting).toBe(false));

    expect(result.current.selectedMicrophone).toBe("mic-usb");
  });

  it("usa câmeras e microfone iniciais do wizard quando ainda existem", async () => {
    installNavigatorMediaDevices([
      { deviceId: "cam-a", kind: "videoinput", label: "A" },
      { deviceId: "cam-b", kind: "videoinput", label: "B" },
      { deviceId: "mic-x", kind: "audioinput", label: "X" },
    ]);

    const { result } = renderHook(() =>
      useDeviceDetection(true, ["cam-b", "cam-a"], "mic-x")
    );

    await waitFor(() => expect(result.current.isDetecting).toBe(false));

    expect(result.current.selectedCameras).toEqual(["cam-b", "cam-a"]);
    expect(result.current.selectedCamera).toBe("cam-b");
    expect(result.current.selectedMicrophone).toBe("mic-x");
  });

  it("expõe erro quando permissão de getUserMedia é negada", async () => {
    enumerateDevices = vi.fn().mockResolvedValue([]);
    getUserMedia = vi.fn().mockRejectedValue(new DOMException("", "NotAllowedError"));

    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      writable: true,
      value: {
        getUserMedia,
        enumerateDevices,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    const { result } = renderHook(() => useDeviceDetection(true));

    await waitFor(() => expect(result.current.isDetecting).toBe(false));

    expect(result.current.error).toContain("Permissão");
    expect(enumerateDevices).not.toHaveBeenCalled();
  });

  it("define erro quando não há câmera nem microfone enumerados", async () => {
    installNavigatorMediaDevices([]);

    const { result } = renderHook(() => useDeviceDetection(true));

    await waitFor(() => expect(result.current.isDetecting).toBe(false));

    expect(result.current.error).toBe("Nenhum dispositivo de mídia encontrado.");
  });

  it("toggleCamera adiciona segunda câmera e selectMicrophone altera o microfone", async () => {
    installNavigatorMediaDevices([
      { deviceId: "cam-1", kind: "videoinput", label: "C1" },
      { deviceId: "cam-2", kind: "videoinput", label: "C2" },
      { deviceId: "mic-1", kind: "audioinput", label: "M1" },
      { deviceId: "mic-2", kind: "audioinput", label: "M2" },
    ]);

    const { result } = renderHook(() => useDeviceDetection(true));

    await waitFor(() => expect(result.current.isDetecting).toBe(false));

    act(() => {
      result.current.toggleCamera("cam-2");
    });
    expect(result.current.selectedCameras).toEqual(["cam-1", "cam-2"]);
    expect(result.current.selectedCamera).toBe("cam-1");

    act(() => {
      result.current.selectMicrophone("mic-2");
    });
    expect(result.current.selectedMicrophone).toBe("mic-2");
  });

  it("não detecta dispositivos quando enabled é false", async () => {
    installNavigatorMediaDevices([
      { deviceId: "cam-1", kind: "videoinput", label: "C1" },
      { deviceId: "mic-1", kind: "audioinput", label: "M1" },
    ]);

    renderHook(() => useDeviceDetection(false));

    await new Promise((r) => setTimeout(r, 30));
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("reage a devicechange chamando enumerateDevices novamente", async () => {
    installNavigatorMediaDevices([
      { deviceId: "cam-1", kind: "videoinput", label: "C1" },
      { deviceId: "mic-1", kind: "audioinput", label: "M1" },
    ]);

    renderHook(() => useDeviceDetection(true));

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(1));

    enumerateDevices.mockResolvedValueOnce([
      { deviceId: "cam-1", kind: "videoinput", label: "C1" },
      { deviceId: "cam-2", kind: "videoinput", label: "C2" },
      { deviceId: "mic-1", kind: "audioinput", label: "M1" },
    ]);

    await act(async () => {
      for (const h of [...deviceChangeHandlers]) {
        await h();
      }
    });

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(2));
  });
});
