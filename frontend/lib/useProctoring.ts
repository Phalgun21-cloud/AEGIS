"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { ViolationAck, ViolationKind } from "@/lib/types";

// In full screen, Chrome and Edge let the page lock the keyboard, so Alt+Tab, the Windows key
// and tab/close shortcuts are swallowed. Ctrl+Alt+Del and holding Esc still escape.
// What it can do: insist on full screen, hide the paper whenever the candidate leaves it,
// keep the camera and microphone on, and report every departure to the server, which
// records it and submits the attempt at the configured limit.

const CLIENT_GAP_MS = 2000; // blur + visibilitychange + fullscreenchange arrive together
const NOISE_LEVEL = 0.12; // RMS of the mic signal (0..1) treated as speaking/loud noise
const NOISE_SUSTAIN_MS = 3000;
const NOISE_COOLDOWN_MS = 30000;
const BLOCKED_KEYS = new Set(["c", "v", "x", "a", "p", "s", "u"]);

type KeyboardLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };
const keyboard = (): KeyboardLock | undefined =>
  typeof navigator === "undefined" ? undefined : (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

export const fullscreenSupported = (): boolean =>
  typeof document !== "undefined" && !!document.fullscreenEnabled;

/**
 * Enter full screen and lock the keyboard. Call directly from a click handler (browsers
 * require a user gesture). Resolves true when the page is in full screen.
 *
 * Keyboard Lock (Chrome, Edge): while in full screen, a page may capture system shortcuts,
 * so Alt+Tab, the Windows key, Ctrl+W/T/N/Tab and Esc reach the page instead of the OS or
 * browser, and the exam swallows them. Only holding Esc for two seconds (a browser safety
 * escape) and Ctrl+Alt+Del still get out; those are detected and counted as violations.
 */
export async function enterFullscreen(): Promise<boolean> {
  if (!fullscreenSupported()) return false;
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    }
    await keyboard()?.lock?.().catch(() => {}); // no list = every key the browser allows
  } catch {
    return false;
  }
  return !!document.fullscreenElement;
}

// Shortcuts that would close, reload, open or switch tabs/windows.
const NAV_KEYS = new Set(["w", "t", "n", "r", "tab", "q", "h", "j", "l", "o", "d", "f", "g", "e"]);

export function leaveFullscreen(): void {
  keyboard()?.unlock?.();
  if (typeof document !== "undefined" && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}

export async function openCameraAndMic(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser can't use a camera. Use a recent Chrome, Edge or Firefox.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: "user" },
      audio: { echoCancellation: true, noiseSuppression: false },
    });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError")
      throw new Error("Camera and microphone access was blocked. Allow both in the browser's address bar (camera icon), then try again.");
    if (name === "NotFoundError") throw new Error("No camera or microphone was found. Connect one and try again.");
    if (name === "NotReadableError") throw new Error("The camera or microphone is in use by another app. Close it and try again.");
    throw new Error("Couldn't start the camera and microphone.");
  }
}

/** Live 0..1 loudness of a stream's audio track; calls `onLevel` about 4 times a second. */
export function watchLevel(stream: MediaStream, onLevel: (rms: number) => void): () => void {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx || !stream.getAudioTracks().length) return () => {};
  const ctx = new Ctx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const t = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    onLevel(Math.sqrt(sum / buf.length));
  }, 250);
  return () => {
    clearInterval(t);
    void ctx.close().catch(() => {});
  };
}

// "muted" means no data is arriving (an OS privacy mute, a hardware mic switch), not just paused.
const liveTrack = (s: MediaStream | null, kind: "video" | "audio") =>
  !!s && s.getTracks().some((t) => t.kind === kind && t.readyState === "live" && t.enabled && !t.muted);

// A covered lens or blacked-out camera: almost no light and almost no detail in the frame.
const COVERED_BRIGHTNESS = 18; // mean luma 0..255
const COVERED_SPREAD = 8; // standard deviation of luma
const COVERED_SUSTAIN_MS = 5000;

type Options = {
  attemptId: string;
  active: boolean; // attempt loaded, not submitted
  mediaRequired: boolean;
  snapshotSeconds: number;
  initialViolations: number;
  maxViolations: number;
  onLimitReached: () => void;
};

export function useProctoring(o: Options) {
  const [isFullscreen, setIsFullscreen] = useState(() => typeof document !== "undefined" && !!document.fullscreenElement);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaOk, setMediaOk] = useState(false);
  const [violations, setViolations] = useState(o.initialViolations);
  const [warning, setWarning] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  const lastReport = useRef(0);
  const requestingMedia = useRef(false); // a permission prompt steals focus: don't count it
  const videoEl = useRef<HTMLVideoElement | null>(null);
  const onLimit = useRef(o.onLimitReached);
  useEffect(() => {
    onLimit.current = o.onLimitReached;
  }, [o.onLimitReached]);

  const report = useCallback(
    async (kind: ViolationKind) => {
      if (!o.active) return;
      if (kind !== "noise") {
        if (requestingMedia.current) return;
        const now = Date.now();
        if (now - lastReport.current < CLIENT_GAP_MS) return;
        lastReport.current = now;
      }
      try {
        const ack = await api<ViolationAck>(`/candidate/attempts/${o.attemptId}/violations`, {
          method: "POST",
          json: { kind },
        });
        setViolations(ack.violations);
        if (ack.submitted) {
          onLimit.current();
        } else if (ack.counted) {
          const left = ack.max_violations ? ack.max_violations - ack.violations : null;
          setWarning(
            `${describe(kind)} This is violation ${ack.violations}` +
              (ack.max_violations ? ` of ${ack.max_violations}. ` : ". ") +
              (left !== null ? `${left === 1 ? "One more" : `${left} more`} and your exam is submitted automatically.` : "It has been recorded."),
          );
        }
      } catch {
        /* offline or already submitted: the server is the authority */
      }
    },
    [o.active, o.attemptId],
  );

  // ----- full screen, tab and window switches -----
  useEffect(() => {
    if (!o.active) return;
    const onFs = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (!fs) void report("fullscreen_exit");
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void report("tab_hidden");
    };
    const onBlur = () => void report("window_blur");
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
    };
  }, [o.active, report]);

  // ----- copy, paste, print, view-source, developer tools, right-click -----
  useEffect(() => {
    if (!o.active) return;
    const stop = (e: Event) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (
        e.key === "F12" ||
        e.key === "F5" ||
        e.key === "F11" ||
        e.key === "Escape" ||
        e.key === "Meta" ||
        e.key === "OS" ||
        (e.altKey && (k === "tab" || k === "f4" || k === "arrowleft" || k === "arrowright")) ||
        (mod && (BLOCKED_KEYS.has(k) || NAV_KEYS.has(k))) ||
        (mod && e.shiftKey && ["i", "j", "c", "k"].includes(k))
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Closing or reloading the tab always asks first while the exam is running.
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    document.addEventListener("contextmenu", stop);
    document.addEventListener("copy", stop);
    document.addEventListener("cut", stop);
    document.addEventListener("paste", stop);
    document.addEventListener("dragstart", stop);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      document.removeEventListener("contextmenu", stop);
      document.removeEventListener("copy", stop);
      document.removeEventListener("cut", stop);
      document.removeEventListener("paste", stop);
      document.removeEventListener("dragstart", stop);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [o.active]);

  // ----- camera and microphone -----
  const startMedia = useCallback(async () => {
    requestingMedia.current = true;
    setMediaError(null);
    try {
      const s = await openCameraAndMic();
      setStream((old) => {
        old?.getTracks().forEach((t) => t.stop());
        return s;
      });
      setMediaOk(true);
    } catch (e) {
      setMediaOk(false);
      setMediaError(e instanceof Error ? e.message : String(e));
    } finally {
      // Let the focus return from the permission prompt before blur counts again.
      setTimeout(() => (requestingMedia.current = false), 1500);
    }
  }, []);

  useEffect(() => {
    if (!o.active || !o.mediaRequired) return;
    void startMedia();
  }, [o.active, o.mediaRequired, startMedia]);

  // Track health: a camera unplugged, covered by a privacy switch or blocked mid-exam.
  useEffect(() => {
    if (!o.active || !o.mediaRequired || !stream) return;
    const check = () => {
      const ok = liveTrack(stream, "video") && liveTrack(stream, "audio");
      setMediaOk((was) => {
        if (was && !ok) void report("camera_off");
        return ok;
      });
    };
    stream.getTracks().forEach((t) => t.addEventListener("ended", check));
    const t = setInterval(check, 2000);
    return () => {
      clearInterval(t);
      stream.getTracks().forEach((tr) => tr.removeEventListener("ended", check));
    };
  }, [o.active, o.mediaRequired, stream, report]);

  // Camera evaluation: a lens covered by a hand, tape or a privacy shutter still sends frames,
  // but they are black and featureless. Sustained for 5 seconds, that counts as a violation.
  useEffect(() => {
    if (!o.active || !o.mediaRequired || !stream) return;
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let coveredSince = 0;
    const t = setInterval(() => {
      const v = videoEl.current;
      if (!ctx || !v || v.readyState < 2 || !v.videoWidth) return;
      ctx.drawImage(v, 0, 0, 64, 48);
      const px = ctx.getImageData(0, 0, 64, 48).data;
      let sum = 0;
      let sq = 0;
      const n = px.length / 4;
      for (let i = 0; i < px.length; i += 4) {
        const y = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        sum += y;
        sq += y * y;
      }
      const mean = sum / n;
      const spread = Math.sqrt(Math.max(0, sq / n - mean * mean));
      const now = Date.now();
      if (mean > COVERED_BRIGHTNESS || spread > COVERED_SPREAD) {
        coveredSince = 0;
        return;
      }
      if (!coveredSince) coveredSince = now;
      if (now - coveredSince >= COVERED_SUSTAIN_MS) {
        coveredSince = 0;
        void report("camera_blocked");
      }
    }, 1000);
    return () => clearInterval(t);
  }, [o.active, o.mediaRequired, stream, report]);

  // The browser Back button would leave the exam: keep the candidate on the page.
  useEffect(() => {
    if (!o.active) return;
    history.pushState(null, "", location.href);
    const onBack = () => {
      history.pushState(null, "", location.href);
      setWarning("Going back is disabled during the exam. Submit your answers to finish.");
    };
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, [o.active]);

  // Self-view.
  const attachVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoEl.current = el;
      if (el && stream && el.srcObject !== stream) {
        el.srcObject = stream;
        void el.play().catch(() => {});
      }
    },
    [stream],
  );

  // Webcam frames for the admin's live monitor.
  useEffect(() => {
    if (!o.active || !stream || !o.snapshotSeconds) return;
    const canvas = document.createElement("canvas");
    const send = () => {
      const v = videoEl.current;
      if (!v || v.readyState < 2 || !v.videoWidth) return;
      canvas.width = 320;
      canvas.height = Math.round((320 * v.videoHeight) / v.videoWidth);
      canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (blob) void api(`/candidate/attempts/${o.attemptId}/snapshot`, { method: "PUT", blob }).catch(() => {});
        },
        "image/jpeg",
        0.6,
      );
    };
    const first = setTimeout(send, 2000);
    const t = setInterval(send, o.snapshotSeconds * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [o.active, o.attemptId, o.snapshotSeconds, stream]);

  // Microphone: sustained loud sound (talking) is flagged; it never ends the attempt.
  useEffect(() => {
    if (!o.active || !stream) return;
    let loudSince = 0;
    let lastFlag = 0;
    return watchLevel(stream, (rms) => {
      setLevel(rms);
      const now = Date.now();
      if (rms < NOISE_LEVEL) {
        loudSince = 0;
        return;
      }
      if (!loudSince) loudSince = now;
      if (now - loudSince >= NOISE_SUSTAIN_MS && now - lastFlag >= NOISE_COOLDOWN_MS) {
        lastFlag = now;
        loudSince = 0;
        void report("noise");
      }
    });
  }, [o.active, stream, report]);

  // Release the camera and full screen once the attempt ends or the page closes.
  useEffect(() => {
    if (o.active) return;
    stream?.getTracks().forEach((t) => t.stop());
    leaveFullscreen();
  }, [o.active, stream]);
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  // A second monitor would let the candidate read notes beside the exam (as SEB refuses).
  // Chrome and Edge expose screen.isExtended; other browsers simply skip this check.
  const [extendedScreen, setExtendedScreen] = useState(false);
  useEffect(() => {
    if (!o.active) return;
    const scr = window.screen as Screen & {
      isExtended?: boolean;
      addEventListener?: (type: string, fn: () => void) => void;
      removeEventListener?: (type: string, fn: () => void) => void;
    };
    const check = () => setExtendedScreen(scr.isExtended === true);
    check();
    scr.addEventListener?.("change", check);
    const t = setInterval(check, 3000);
    return () => {
      clearInterval(t);
      scr.removeEventListener?.("change", check);
    };
  }, [o.active]);

  const needsFullscreen = o.active && fullscreenSupported() && !isFullscreen;
  const needsMedia = o.active && o.mediaRequired && !mediaOk;
  const needsSingleScreen = o.active && extendedScreen;

  return {
    blocked: needsFullscreen || needsMedia || needsSingleScreen,
    needsFullscreen,
    needsMedia,
    needsSingleScreen,
    mediaError,
    retryMedia: startMedia,
    violations,
    warning,
    dismissWarning: () => setWarning(null),
    attachVideo,
    hasVideo: !!stream,
    level,
  };
}

function describe(kind: ViolationKind): string {
  switch (kind) {
    case "fullscreen_exit":
      return "You left full screen.";
    case "tab_hidden":
      return "You switched away from the exam tab.";
    case "window_blur":
      return "You switched to another window.";
    case "camera_off":
      return "Your camera or microphone stopped or was muted.";
    case "camera_blocked":
      return "Your camera is covered or showing a black picture. Keep your face clearly visible.";
    default:
      return "";
  }
}
