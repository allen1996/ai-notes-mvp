import { useEffect, useRef, useState } from "react";

export function useRecorder() {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const accumulated = useRef(0);
  const segmentStart = useRef(0);
  const mounted = useRef(true);
  const starting = useRef(false);
  const [state, setState] = useState<
    "idle" | "recording" | "paused" | "stopped"
  >("idle");
  const [seconds, setSeconds] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current?.state !== "inactive") recorder.current?.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(() => {
    if (state !== "recording") return;
    const timer = window.setInterval(
      () =>
        setSeconds(
          (accumulated.current + Date.now() - segmentStart.current) / 1000,
        ),
      200,
    );
    return () => clearInterval(timer);
  }, [state]);

  async function start() {
    if (
      starting.current || recorder.current?.state === "recording" ||
      recorder.current?.state === "paused"
    ) return;
    starting.current = true;
    setError("");
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      ) {
        throw new Error(
          "Recording is unavailable in this browser. Use the audio upload option.",
        );
      }
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const instance = new MediaRecorder(
        media,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.current = instance;
      chunks.current = [];
      accumulated.current = 0;
      segmentStart.current = Date.now();
      setSeconds(0);
      setFile(null);
      instance.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      instance.onstop = () => {
        media.getTracks().forEach((track) => track.stop());
        if (!mounted.current) return;
        const extension = instance.mimeType.includes("mp4")
          ? "m4a"
          : instance.mimeType.includes("ogg")
          ? "ogg"
          : "webm";
        setFile(
          new File(chunks.current, `meeting.${extension}`, {
            type: instance.mimeType,
          }),
        );
        setSeconds(accumulated.current / 1000);
        setState("stopped");
      };
      instance.onerror = () => {
        media.getTracks().forEach((track) => track.stop());
        setError(
          "Recording was interrupted. Please try again or upload a file.",
        );
      };
      instance.start(1000);
      setState("recording");
    } catch (cause) {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (mounted.current) {
        setError(
          cause instanceof Error ? cause.message : "Microphone access failed.",
        );
      }
    } finally {
      starting.current = false;
    }
  }
  function pause() {
    if (recorder.current?.state !== "recording") return;
    accumulated.current += Date.now() - segmentStart.current;
    recorder.current.pause();
    setState("paused");
  }
  function resume() {
    if (recorder.current?.state !== "paused") return;
    segmentStart.current = Date.now();
    recorder.current.resume();
    setState("recording");
  }
  function stop() {
    if (!recorder.current || recorder.current.state === "inactive") return;
    if (recorder.current.state === "recording") {
      accumulated.current += Date.now() - segmentStart.current;
    }
    recorder.current.stop();
  }
  return { state, seconds, file, error, start, pause, resume, stop };
}
