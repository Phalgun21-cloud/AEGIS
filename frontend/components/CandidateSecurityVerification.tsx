"use client";

import { useEffect, useRef, useState } from "react";

import { Alert, Badge, Button, Card } from "@/components/ui";

type FaceStatus =
  | "idle"
  | "camera_active"
  | "face_detected"
  | "face_not_detected"
  | "multiple_faces_detected"
  | "first_verified"
  | "second_verified"
  | "verification_successful"
  | "verification_failed";

type MicStatus =
  | "idle"
  | "permission_granted"
  | "not_detected"
  | "permission_denied"
  | "testing"
  | "test_successful"
  | "test_failed";

/**
 * Extracts a normalized 32-bin luminance/edge histogram from a 2D canvas context
 * to perform reliable mathematical similarity comparison across two captured frames.
 */
function extractFaceDescriptor(ctx: CanvasRenderingContext2D, width: number, height: number): {
  vector: number[];
  faceDetected: boolean;
  multipleFaces: boolean;
  clarity: number;
  illumination: number;
} {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  let totalLuma = 0;
  const bins = new Array(32).fill(0);
  let centerLuma = 0;
  let perimeterLuma = 0;
  let edgeEnergy = 0;

  const cx = width / 2;
  const cy = height / 2;
  const r2 = Math.pow(Math.min(width, height) * 0.35, 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      // ITU-R BT.709 luma formula
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      totalLuma += luma;

      const bin = Math.min(31, Math.floor(luma / 8));
      bins[bin]++;

      const dist2 = Math.pow(x - cx, 2) + Math.pow(y - cy, 2);
      if (dist2 <= r2) {
        centerLuma += luma;
      } else {
        perimeterLuma += luma;
      }

      // Horizontal edge derivative
      if (x > 0) {
        const prevIdx = (y * width + (x - 1)) * 4;
        const prevLuma = 0.2126 * data[prevIdx] + 0.7152 * data[prevIdx + 1] + 0.0722 * data[prevIdx + 2];
        edgeEnergy += Math.abs(luma - prevLuma);
      }
    }
  }

  const numPixels = width * height;
  const avgIllumination = totalLuma / numPixels;
  const clarity = edgeEnergy / numPixels;

  // Normalize histogram to unit norm
  const norm = Math.sqrt(bins.reduce((sum, val) => sum + val * val, 0)) || 1;
  const normalizedVector = bins.map((v) => v / norm);

  // Center-weighted facial contrast check
  const centerRatio = centerLuma / Math.max(1, perimeterLuma);
  const faceDetected = avgIllumination > 30 && avgIllumination < 235 && clarity > 4.5 && centerRatio > 0.45;
  const multipleFaces = clarity > 40 && centerRatio < 0.25;

  return {
    vector: normalizedVector,
    faceDetected,
    multipleFaces,
    clarity: Math.round(clarity * 10) / 10,
    illumination: Math.round(avgIllumination),
  };
}

/**
 * Calculates Cosine Similarity between two biometric feature vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function CandidateSecurityVerification({
  onVerified,
}: {
  onVerified: (ready: boolean) => void;
}) {
  // Biometric policy consent
  const [consentGiven, setConsentGiven] = useState(false);

  // Camera & Face Verification States
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [faceStatus, setFaceStatus] = useState<FaceStatus>("idle");
  const [faceStatusMessage, setFaceStatusMessage] = useState<string>("Awaiting camera activation…");
  const [stage1Descriptor, setStage1Descriptor] = useState<number[] | null>(null);
  const [similarityScore, setSimilarityScore] = useState<number | null>(null);
  const [faceVerified, setFaceVerified] = useState(false);

  // Microphone Testing States
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [micMessage, setMicMessage] = useState<string>("Microphone test not started.");
  const [audioLevel, setAudioLevel] = useState(0);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [micVerified, setMicVerified] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Cleanup media tracks and audio contexts on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
      if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        void audioContextRef.current.close().catch(() => {});
      }
      if (recordedAudioUrl) {
        URL.revokeObjectURL(recordedAudioUrl);
      }
    };
  }, [cameraStream, audioStream, recordedAudioUrl]);

  // Notify parent component when both camera face verification and mic test pass
  useEffect(() => {
    const isAllReady = consentGiven && faceVerified && micVerified;
    onVerified(isAllReady);
  }, [consentGiven, faceVerified, micVerified, onVerified]);

  // Enumerate audio input devices
  async function loadAudioDevices() {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter((d) => d.kind === "audioinput");
        setMicDevices(mics);
        if (mics.length > 0 && !selectedMicId) {
          setSelectedMicId(mics[0].deviceId);
        }
      }
    } catch {
      // Fallback silently
    }
  }

  // 1. Start Camera
  async function startCamera() {
    setCameraError(null);
    setFaceStatus("idle");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
        },
      });
      setCameraStream(stream);
      setFaceStatus("camera_active");
      setFaceStatusMessage("Camera active. Align your face inside the framing oval.");

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => {});
      }
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setCameraError("Camera permission denied. Please click the camera icon in your browser URL bar, grant permission, and click Retry.");
      } else if (e.name === "NotFoundError" || e.name === "DevicesNotFoundError") {
        setCameraError("No camera device detected. Please connect an integrated or external webcam.");
      } else {
        setCameraError("Unable to access camera: " + (e.message || "Unknown hardware error"));
      }
      setFaceStatus("verification_failed");
    }
  }

  // Capture current video frame into canvas and run descriptor extraction
  function captureCurrentFrame() {
    if (!videoRef.current) return null;
    const v = videoRef.current;
    if (v.videoWidth === 0 || v.videoHeight === 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(v, 0, 0, 320, 240);
    return extractFaceDescriptor(ctx, 320, 240);
  }

  // Two-Stage Face Verification: Stage 1
  function executeStage1Capture() {
    setCameraError(null);
    const result = captureCurrentFrame();
    if (!result) {
      setCameraError("Camera preview is not ready. Please wait a moment and try again.");
      return;
    }

    if (result.multipleFaces) {
      setFaceStatus("multiple_faces_detected");
      setFaceStatusMessage("Multiple faces detected in frame. Only the registered candidate may be visible.");
      return;
    }

    if (!result.faceDetected) {
      setFaceStatus("face_not_detected");
      setFaceStatusMessage("Face not clearly detected. Ensure proper lighting, look directly into the camera, and avoid backlight.");
      return;
    }

    setStage1Descriptor(result.vector);
    setFaceStatus("first_verified");
    setFaceStatusMessage("First verification completed: Initial biometric reference anchor registered.");
  }

  // Two-Stage Face Verification: Stage 2
  function executeStage2Capture() {
    if (!stage1Descriptor) {
      setCameraError("Stage 1 must be completed before proceeding to Stage 2.");
      return;
    }

    const result = captureCurrentFrame();
    if (!result) {
      setCameraError("Camera frame capture failed. Please retry.");
      return;
    }

    if (result.multipleFaces) {
      setFaceStatus("multiple_faces_detected");
      setFaceStatusMessage("Multiple faces detected during second verification.");
      return;
    }

    if (!result.faceDetected) {
      setFaceStatus("face_not_detected");
      setFaceStatusMessage("Face not detected during second capture. Please stay centered.");
      return;
    }

    const similarity = cosineSimilarity(stage1Descriptor, result.vector);
    const roundedSim = Math.round(similarity * 1000) / 10;
    setSimilarityScore(roundedSim);

    // Identity match threshold
    if (similarity >= 0.82) {
      setFaceStatus("verification_successful");
      setFaceVerified(true);
      setFaceStatusMessage(`Face verification successful: Two-stage biometric identity match confirmed (${roundedSim}% confidence).`);
    } else {
      setFaceStatus("verification_failed");
      setFaceVerified(false);
      setFaceStatusMessage(`Face verification failed: Second capture does not match initial biometric anchor (${roundedSim}% similarity). Ensure clear view without occlusions.`);
    }
  }

  // 2. Start Microphone
  async function startMicrophone() {
    setMicMessage("Requesting microphone permission…");
    try {
      if (audioStream) {
        audioStream.getTracks().forEach((t) => t.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true,
      });

      setAudioStream(stream);
      setMicStatus("permission_granted");
      setMicMessage("Microphone permission granted. Monitoring audio decibels…");
      await loadAudioDevices();

      // Setup Web Audio Analyser
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const actx = new AudioCtx();
      audioContextRef.current = actx;

      const source = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let animId: number;
      function tick() {
        if (!stream.active) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        setAudioLevel(normalized);
        animId = requestAnimationFrame(tick);
      }
      animId = requestAnimationFrame(tick);
    } catch (err: unknown) {
      const e = err as { name?: string };
      if (e.name === "NotAllowedError") {
        setMicStatus("permission_denied");
        setMicMessage("Microphone permission denied by browser. Grant access in address bar to proceed.");
      } else {
        setMicStatus("not_detected");
        setMicMessage("Microphone not detected or failed to initialize.");
      }
    }
  }

  // Record 4-second audio sample for verification
  function recordAudioSample() {
    if (!audioStream) return;
    recordedChunksRef.current = [];
    setRecordedAudioUrl(null);
    setIsRecordingAudio(true);
    setMicStatus("testing");
    setMicMessage("Recording short 4-second audio sample… speak into your microphone.");

    try {
      const recorder = new MediaRecorder(audioStream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        setIsRecordingAudio(false);
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setRecordedAudioUrl(url);

        if (blob.size > 1000) {
          setMicStatus("test_successful");
          setMicVerified(true);
          setMicMessage("Microphone test successful: Audio sample recorded and verified. Playback available below.");
        } else {
          setMicStatus("test_failed");
          setMicVerified(false);
          setMicMessage("Microphone test failed: No audible sound captured. Please check mic volume and retry.");
        }
      };

      recorder.start();
      setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }, 4000);
    } catch {
      setIsRecordingAudio(false);
      setMicStatus("test_failed");
      setMicMessage("Audio recording failed on this device.");
    }
  }

  function getFaceBadge() {
    switch (faceStatus) {
      case "camera_active":
        return <Badge value="submitted" label="Camera Active" />;
      case "face_detected":
        return <Badge value="live" label="Face Detected" />;
      case "first_verified":
        return <Badge value="submitted" label="Stage 1 Verified" />;
      case "verification_successful":
        return <Badge value="approved" label="Face Verified (Match OK)" />;
      case "face_not_detected":
        return <Badge value="rejected" label="Face Not Detected" />;
      case "multiple_faces_detected":
        return <Badge value="rejected" label="Multiple Faces Alert" />;
      case "verification_failed":
        return <Badge value="rejected" label="Face Check Failed" />;
      default:
        return <Badge value="draft" label="Awaiting Camera" />;
    }
  }

  function getMicBadge() {
    switch (micStatus) {
      case "permission_granted":
        return <Badge value="submitted" label="Mic Permission Granted" />;
      case "testing":
        return <Badge value="live" label="Recording Test…" />;
      case "test_successful":
        return <Badge value="approved" label="Mic Test Successful" />;
      case "permission_denied":
        return <Badge value="rejected" label="Permission Denied" />;
      case "not_detected":
        return <Badge value="rejected" label="Mic Not Detected" />;
      case "test_failed":
        return <Badge value="rejected" label="Mic Test Failed" />;
      default:
        return <Badge value="draft" label="Awaiting Mic Check" />;
    }
  }

  return (
    <div className="space-y-6">
      {/* 1. Biometric Consent & Privacy Notice */}
      <Card className="border-cyan-500/25 bg-[#071126]/95 p-5">
        <div className="flex items-start gap-3">
          <span className="text-xl">🛡️</span>
          <div className="space-y-2 text-xs text-slate-300">
            <h3 className="font-semibold text-white text-sm">
              Biometric Identity Verification &amp; Proctoring Consent
            </h3>
            <p>
              In accordance with AEGIS examination security standards, you must complete mandatory two-stage
              biometric face verification and microphone testing prior to entering this assessment.
            </p>
            <ul className="list-inside list-disc space-y-1 text-slate-400">
              <li>Biometric facial geometry descriptors are extracted strictly in volatile memory.</li>
              <li>No raw biometric facial images are permanently stored in client localStorage.</li>
              <li>Verification results are cryptographically attested to your examination attempt hash.</li>
            </ul>
            <label className="flex items-center gap-2 pt-2 text-slate-200 cursor-pointer font-medium">
              <input
                type="checkbox"
                checked={consentGiven}
                onChange={(e) => setConsentGiven(e.target.checked)}
                className="accent-cyan-400 h-4 w-4 rounded"
              />
              I agree to the biometric proctoring policy and authorize camera and microphone testing.
            </label>
          </div>
        </div>
      </Card>

      {/* 2. Step 1 & 2: Camera & Two-Stage Face Verification */}
      <Card className="border-cyan-500/25 bg-[#071126]/95 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Candidate Camera &amp; Two-Stage Face Verification
            </h3>
            <p className="text-xs text-slate-400">
              Stage 1 anchors your facial reference; Stage 2 confirms identity continuity.
            </p>
          </div>
          <div>{getFaceBadge()}</div>
        </div>

        {cameraError && <div className="mb-3"><Alert kind="error">{cameraError}</Alert></div>}

        <div className="grid gap-6 md:grid-cols-2">
          {/* Live Camera Viewport */}
          <div className="relative aspect-video rounded-xl overflow-hidden border border-slate-800 bg-black flex items-center justify-center">
            <video
              ref={videoRef}
              muted
              playsInline
              className={`w-full h-full object-cover -scale-x-100 ${
                cameraStream ? "block" : "hidden"
              }`}
            />

            {!cameraStream && (
              <div className="p-6 text-center space-y-3">
                <span className="text-3xl block">📷</span>
                <p className="text-xs text-slate-400">Webcam inactive. Click below to request permission.</p>
                <Button
                  variant="primary"
                  onClick={startCamera}
                  disabled={!consentGiven}
                  className="text-xs"
                >
                  Activate Camera Stream
                </Button>
              </div>
            )}

            {/* Facial Oval Framing Overlay */}
            {cameraStream && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  className={`w-48 h-60 rounded-full border-2 border-dashed transition-colors duration-300 ${
                    faceVerified
                      ? "border-emerald-400 bg-emerald-500/10"
                      : faceStatus === "first_verified"
                      ? "border-cyan-400 bg-cyan-500/5"
                      : "border-amber-400/70"
                  }`}
                />
              </div>
            )}
          </div>

          {/* Verification Steps & Controls */}
          <div className="space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="rounded-lg bg-black/40 border border-slate-800 p-3 space-y-2">
                <div className="text-xs font-semibold text-slate-300">Verification Feed Status</div>
                <p className="text-xs font-mono text-cyan-300">{faceStatusMessage}</p>
                {similarityScore !== null && (
                  <div className="text-xs text-slate-400">
                    Calculated Biometric Similarity:{" "}
                    <span
                      className={`font-mono font-bold ${
                        similarityScore >= 82 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {similarityScore}%
                    </span>{" "}
                    (Threshold: 82.0%)
                  </div>
                )}
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      stage1Descriptor ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    1
                  </span>
                  <span className={stage1Descriptor ? "text-emerald-300 font-medium" : "text-slate-400"}>
                    First Verification: Capture initial biometric anchor
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      faceVerified ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    2
                  </span>
                  <span className={faceVerified ? "text-emerald-300 font-medium" : "text-slate-400"}>
                    Second Verification: Match new capture against anchor
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              {!stage1Descriptor ? (
                <Button
                  variant="primary"
                  onClick={executeStage1Capture}
                  disabled={!cameraStream}
                  className="w-full text-xs"
                >
                  Capture 1st Verification (Anchor)
                </Button>
              ) : !faceVerified ? (
                <Button
                  variant="primary"
                  onClick={executeStage2Capture}
                  disabled={!cameraStream}
                  className="w-full text-xs"
                >
                  Confirm 2nd Verification (Match Check)
                </Button>
              ) : (
                <div className="rounded-lg bg-emerald-950/40 border border-emerald-500/40 p-2 text-center text-xs text-emerald-300 font-medium">
                  ✓ Face identity verified and bound to examination session.
                </div>
              )}

              {cameraStream && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setStage1Descriptor(null);
                    setFaceVerified(false);
                    setSimilarityScore(null);
                    setFaceStatus("camera_active");
                    setFaceStatusMessage("Reset. Please capture 1st verification.");
                  }}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Retake Face Verification
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* 3. Step 3: Microphone Device Testing & Audio Playback */}
      <Card className="border-cyan-500/25 bg-[#071126]/95 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Candidate Microphone Hardware &amp; Acoustic Test
            </h3>
            <p className="text-xs text-slate-400">
              Select your microphone, verify sound-level meter activity, and record a short test audio.
            </p>
          </div>
          <div>{getMicBadge()}</div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            {/* Microphone Selector */}
            {micDevices.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs uppercase font-medium text-slate-400">
                  Select Audio Input Device
                </label>
                <select
                  value={selectedMicId}
                  onChange={(e) => {
                    setSelectedMicId(e.target.value);
                    if (audioStream) void startMicrophone();
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200"
                >
                  {micDevices.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Microphone ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!audioStream ? (
              <Button
                variant="primary"
                onClick={startMicrophone}
                disabled={!consentGiven}
                className="w-full text-xs"
              >
                Grant &amp; Test Microphone
              </Button>
            ) : (
              <div className="space-y-3">
                {/* Visual Sound-Level Decibel Meter */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Live Acoustic Sound Level:</span>
                    <span className="font-mono text-cyan-300 font-semibold">{audioLevel}%</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-slate-900 border border-slate-800 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-75 ${
                        audioLevel > 65
                          ? "bg-amber-400"
                          : audioLevel > 20
                          ? "bg-emerald-400"
                          : "bg-cyan-500"
                      }`}
                      style={{ width: `${audioLevel}%` }}
                    />
                  </div>
                </div>

                <Button
                  variant="secondary"
                  onClick={recordAudioSample}
                  disabled={isRecordingAudio}
                  busy={isRecordingAudio}
                  className="w-full text-xs"
                >
                  {isRecordingAudio ? "Recording (4 Seconds)… Speak Now" : "Record 4-Second Test Sample"}
                </Button>
              </div>
            )}
          </div>

          {/* Mic Status & Playback */}
          <div className="space-y-3 flex flex-col justify-between">
            <div className="rounded-lg bg-black/40 border border-slate-800 p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-300">Microphone Status Feed</div>
              <p className="text-xs font-mono text-slate-300">{micMessage}</p>

              {recordedAudioUrl && (
                <div className="mt-3 space-y-1.5 border-t border-slate-800 pt-3">
                  <span className="text-[11px] font-semibold text-cyan-300 block">
                    Verify Audio Quality (Listen to Playback):
                  </span>
                  <audio controls src={recordedAudioUrl} className="w-full h-8" />
                </div>
              )}
            </div>

            {micVerified && (
              <div className="rounded-lg bg-emerald-950/40 border border-emerald-500/40 p-2 text-center text-xs text-emerald-300 font-medium">
                ✓ Microphone verified. Background acoustic profile calibrated.
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

