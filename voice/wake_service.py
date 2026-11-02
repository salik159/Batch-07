#!/usr/bin/env python3
"""NeuraOS always-on voice service.

Owns the ONE microphone stream of the whole app. Talks to Electron over stdin/stdout, one JSON
object per line.  Everything runs locally: no audio ever leaves this process.

Pipeline
    microphone (PortAudio callback, lightweight: copy + enqueue only)
      -> bounded queue
      -> processing thread: adaptive-noise VAD segmenter
         -> state-gated handling (the state is owned by Electron and mirrored here via set_state)
              idle      WAKE    short speech bursts only; Whisper runs on at most the first 1.8 s of a
                                burst, never continuously and never on long speech
              listening CAPTURE records ONE command utterance, transcribes it, reports it
              thinking/executing/speaking
                        WATCH   only "stop / cancel / stop listening" (and "Hey Neura" barge-in while
                                speaking) are recognised; echo of Neura's own speech is filtered out
              activated/stopping/error/waiting   MUTE (own voice, reverb, nothing is processed)

Events written to stdout (JSON lines):
    status{phase,message}  ready  heartbeat  state_changed
    wake{text}  wake_with_command{command}  command{text}  stop{kind}  listen_timeout
    mic_open  mic_lost  mic_recovered  mic_silent  warning  error{code,fatal,message,hint}

Commands read from stdin: set_state{state,tts_text}  ping  exit  emulate{text} (dev only)
Stdin EOF (parent died) terminates the service, so a crashed Electron can never leave an orphan
service holding the microphone.
"""
from __future__ import annotations

import argparse
import collections
import difflib
import json
import os
import queue
import re
import sys
import tempfile
import threading
import time
import traceback
import wave

try:  # numpy is a hard requirement; report it in a machine-readable way instead of a traceback
    import numpy as np
except ImportError as _e:  # pragma: no cover
    sys.stdout.write(json.dumps({"event": "error", "code": "dependency_missing", "fatal": True,
                                 "message": f"Python package missing: {_e}",
                                 "hint": "Run voice\\setup.ps1 to install the voice dependencies."}) + "\n")
    sys.stdout.flush()
    sys.exit(2)

SR = 16000
FRAME = 480  # 30 ms
VALID_STATES = {"idle", "activated", "listening", "thinking", "executing", "speaking", "stopping", "error", "waiting"}
MODE = {"idle": "wake", "listening": "capture", "thinking": "watch", "executing": "watch", "speaking": "watch"}
# seconds of audio ignored right after entering a state (reverb tail of Neura's own voice)
GUARD = {"idle": 0.30, "listening": 0.25}

_out_lock = threading.Lock()
_DEBUG = os.environ.get("NEURA_VOICE_DEBUG") == "1"


def emit(event: str, **kw):
    kw["event"] = event
    kw.setdefault("ts", round(time.time(), 3))
    line = json.dumps(kw, ensure_ascii=False)
    with _out_lock:
        try:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()
        except Exception:
            pass


def log(msg: str):
    try:
        sys.stderr.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")
        sys.stderr.flush()
    except Exception:
        pass


def dbg(msg: str):
    if _DEBUG:
        log("DBG " + msg)


def fatal(code: str, message: str, hint: str = "", exit_code: int = 2):
    emit("error", code=code, fatal=True, message=message, hint=hint)
    sys.exit(exit_code)


# --------------------------------------------------------------------------------------------
# Text matching (pure functions, unit-tested)
# --------------------------------------------------------------------------------------------
GREETINGS = {"hey", "hay", "hi", "hello", "ok", "okay", "yo", "hei", "hate", "he", "eh", "ay", "a"}
NAME_VARIANTS = {"neura", "nura", "nora", "neuro", "nuro", "newra", "nuera", "neurah", "norah", "noora",
                 "nyura", "nera", "niura", "nyra", "nure", "nuyra", "neora", "nehra", "nuhra"}
NAME_STRICT = re.compile(r"^n[ey]?u[e]?r[aoh]h?$")  # neura nura nuera neuro nuro neurah (no greeting needed)


def clean_token(w: str) -> str:
    return re.sub(r"[^a-z0-9']", "", w.lower())


def _skeleton(t: str) -> str:
    t = re.sub(r"[aeiouywh']", "", t)
    return re.sub(r"(.)\1+", r"\1", t)


def is_name(tok: str) -> bool:
    """Lenient: used only right after a greeting ("hey ...")."""
    if not tok or tok[0] != "n" or not (3 <= len(tok) <= 8):
        return False
    if tok in NAME_VARIANTS or NAME_STRICT.match(tok):
        return True
    if _skeleton(tok) == "nr":
        return True
    return difflib.SequenceMatcher(None, tok, "neura").ratio() >= 0.75


def match_wake(text: str):
    """Return (matched, rest). Whisper writes "Hey Neura" many ways (commas, "Nora", "Nura",
    "new ra"); any of them right at the start of the utterance counts."""
    words = (text or "").strip().split()
    norm = [clean_token(w) for w in words]
    n = len(words)
    for start in (0, 1):
        i = start
        greeted = False
        if i < n and norm[i] in GREETINGS:
            greeted = True
            i += 1
        elif start == 1:
            continue
        for width in (1, 2):
            if i + width > n:
                continue
            tok = "".join(norm[i:i + width])
            if width == 2 and len(norm[i]) > 3:
                continue
            ok = is_name(tok) if greeted else bool(NAME_STRICT.match(tok))
            if ok:
                rest = " ".join(words[i + width:]).strip(" ,.!?:;-")
                return True, rest
    return False, ""


_CONTROL = {
    "stop_listening": {"stop listening", "stop listing", "stop the listening"},
    "cancel": {"cancel", "cancel that", "cancel it", "cancel task", "cancel the task", "cancel command",
               "cancel this", "never mind", "nevermind"},
    "stop": {"stop", "stop speaking", "stop talking", "stop it", "stop there", "that's enough", "thats enough",
             "enough", "be quiet", "quiet", "shut up", "stop please", "please stop"},
}


def norm_text(text: str) -> str:
    t = re.sub(r"[^a-z0-9' ]", " ", (text or "").lower())
    return re.sub(r"\s+", " ", t).strip()


def match_control(text: str):
    """"Neura, stop" / "stop speaking" / "cancel" / "stop listening" -> kind, else None.
    Only short utterances count, so "don't stop the music" or Neura's own sentences never match."""
    toks = norm_text(text).split()
    if not toks or len(toks) > 6:
        return None
    core = []
    for i, t in enumerate(toks):
        if (t in GREETINGS and i == 0) or (is_name(t) and (i <= 1 or NAME_STRICT.match(t))):
            continue
        core.append(t)
    core_s = " ".join(core)
    for kind, phrases in _CONTROL.items():
        if core_s in phrases:
            return kind
    return None


HALLUCINATIONS = {"thank you", "thanks", "thanks for watching", "thank you for watching", "you", "bye",
                  "bye bye", "uh", "um", "hmm", "mm", "oh", "the"}


# --------------------------------------------------------------------------------------------
# VAD segmenter
# --------------------------------------------------------------------------------------------
class Seg:
    __slots__ = ("t0", "t1", "audio", "voiced", "peak_rms", "forced")

    def __init__(self, t0, t1, audio, voiced, peak_rms, forced):
        self.t0, self.t1, self.audio, self.voiced, self.peak_rms, self.forced = t0, t1, audio, voiced, peak_rms, forced

    @property
    def duration(self):
        return len(self.audio) / SR


class Segmenter:
    """Energy VAD with an adaptive noise floor (works for quiet laptop arrays and noisy rooms)."""

    def __init__(self, min_rms=0.003, ratio=3.0):
        self.min_rms, self.ratio = min_rms, ratio
        self.noise = min_rms
        self.last_rms = 0.0
        self.pre = collections.deque(maxlen=10)
        self.reset()

    def reset(self):
        self.in_speech = False
        self.keep_audio = True
        self.frames = []
        self.n = 0
        self.start_run = 0
        self.sil = 0.0
        self.t0 = 0.0
        self.voiced = 0
        self.peak = 0.0
        self.pre.clear()

    @property
    def thr(self):
        return max(self.min_rms, self.noise * self.ratio)

    @property
    def duration(self):
        return self.n / SR

    def audio(self):
        return np.concatenate(self.frames) if self.frames else np.zeros(0, np.float32)

    def feed(self, frame, t, end_silence, max_len):
        rms = float(np.sqrt(np.mean(frame * frame))) if len(frame) else 0.0
        self.last_rms = rms
        thr = self.thr
        dur = len(frame) / SR
        if not self.in_speech:
            # follow the noise floor; ignore loud (possible speech) frames except for a very slow creep
            if rms <= self.noise * 2 + 1e-4:
                self.noise += (rms - self.noise) * 0.02
            else:
                self.noise += (rms - self.noise) * 0.002
            if rms > thr:
                self.start_run += 1
            else:
                self.start_run = 0
            if self.start_run >= 2:
                self.in_speech = True
                self.frames = list(self.pre) + [frame]
                self.n = sum(len(f) for f in self.frames)
                self.t0 = t - (self.n - len(frame)) / SR
                self.sil = 0.0
                self.voiced = self.start_run
                self.peak = rms
                self.pre.clear()
            else:
                self.pre.append(frame)
            return None
        # in speech
        if self.keep_audio:
            self.frames.append(frame)
        self.n += len(frame)
        if rms > thr:
            self.voiced += 1
            self.peak = max(self.peak, rms)
        if rms < thr * 0.6:
            self.sil += dur
        else:
            self.sil = 0.0
        forced = self.n / SR >= max_len
        if self.sil >= end_silence or forced:
            seg = Seg(self.t0, t + dur, self.audio(), self.voiced, self.peak, forced)
            self.reset()
            return seg
        return None


# --------------------------------------------------------------------------------------------
# Speech-to-text back ends
# --------------------------------------------------------------------------------------------
class WhisperSTT:
    """Local faster-whisper. A small model for wake/stop bursts, a better one for commands."""

    def __init__(self, wake_model: str, cmd_model: str):
        self.names = {"wake": wake_model, "cmd": cmd_model}
        self.models = {}

    def load(self):
        from faster_whisper import WhisperModel
        cache = {}
        for kind, name in self.names.items():
            if name not in cache:
                cache[name] = WhisperModel(name, device="cpu", compute_type="int8")
            self.models[kind] = cache[name]

    @staticmethod
    def _agc(a):
        peak = float(np.max(np.abs(a))) if len(a) else 0.0
        if 0 < peak < 0.3:
            a = a * min(10.0, 0.3 / peak)
        return a.astype(np.float32)

    def transcribe(self, audio, kind, t0=0.0):
        model = self.models["wake" if kind == "wake" else "cmd"]
        kw = dict(language="en", beam_size=1 if kind == "wake" else 5, temperature=0.0, vad_filter=False,
                  condition_on_previous_text=False, without_timestamps=True)
        if kind == "wake":
            kw["hotwords"] = "Neura"
        try:
            segments, _ = model.transcribe(self._agc(audio), **kw)
        except TypeError:  # older faster-whisper without hotwords
            kw.pop("hotwords", None)
            segments, _ = model.transcribe(self._agc(audio), **kw)
        parts = []
        for s in segments:
            if getattr(s, "no_speech_prob", 0) > 0.7 and getattr(s, "avg_logprob", 0) < -0.8:
                continue
            if getattr(s, "avg_logprob", 0) < -1.6:
                continue
            parts.append(s.text.strip())
        return " ".join(p for p in parts if p).strip()


class ScriptedSTT:
    """TEST ONLY. Returns the scripted transcript of whichever scripted utterance overlaps the audio
    segment on the audio clock. Used to exercise the real mic/VAD/state pipeline without a speech model."""

    def __init__(self, path):
        with open(path, "r", encoding="utf-8") as f:
            self.items = json.load(f)

    def load(self):
        pass

    def transcribe(self, audio, kind, t0=0.0):
        t1 = t0 + len(audio) / SR
        best, best_ov = "", 0.15
        for it in self.items:
            ov = min(t1, it["end"]) - max(t0, it["start"])
            if ov > best_ov:
                best, best_ov = it["text"], ov
        return best


# --------------------------------------------------------------------------------------------
# Engine
# --------------------------------------------------------------------------------------------
class Config:
    def __init__(self, env=None):
        e = env if env is not None else os.environ
        g = lambda k, d: e.get(k, d)
        self.wake_model = g("NEURA_WAKE_MODEL", "tiny.en")
        self.cmd_model = g("NEURA_CMD_MODEL", g("LOCAL_WHISPER_MODEL", "base.en"))
        self.device = g("NEURA_AUDIO_DEVICE", "")
        self.min_rms = float(g("NEURA_MIN_RMS", "0.003"))
        self.vad_ratio = float(g("NEURA_VAD_RATIO", "3.0"))
        self.listen_timeout = float(g("NEURA_LISTEN_TIMEOUT", "8.0"))
        self.cmd_max = float(g("NEURA_CMD_MAX", "20.0"))
        self.cmd_end_silence = float(g("NEURA_CMD_END_SILENCE", "0.9"))
        self.wake_early = float(g("NEURA_WAKE_EARLY", "1.8"))
        self.watch_max = float(g("NEURA_WATCH_MAX", "2.5"))
        self.watch_min_rms = float(g("NEURA_WATCH_MIN_RMS", "0.0"))
        self.allow_emulate = g("NEURA_DEV_EMULATE", "") == "1"
        self.queue_frames = 400


class Engine:
    def __init__(self, stt, cfg: Config, emit_fn=emit):
        self.stt, self.cfg, self.emit = stt, cfg, emit_fn
        self.q = queue.Queue(maxsize=cfg.queue_frames)
        self.lock = threading.RLock()
        self.state = "idle"
        self.state_t0 = 0.0
        self.guard_until = 0.0
        self.audio_t = 0.0
        self.seg = Segmenter(cfg.min_rms, cfg.vad_ratio)
        self.tts_ring = collections.deque(maxlen=4)
        self.stt_ready = False
        self.mic_ok = True
        self.running = True
        self.overflows = 0
        self.errors_in_row = 0
        self.last_frame_wall = time.monotonic()
        self.last_warn = 0.0
        self.max_abs_window = 0.0
        self.window_start = 0.0
        self.silent_reported = False
        self.counters = collections.Counter()
        self._reset_utt()

    # ---- audio thread side --------------------------------------------------------------
    def push(self, frame, t, block=False):
        if block:
            while self.running:
                try:
                    self.q.put((frame, t), timeout=0.2)
                    return
                except queue.Full:
                    continue
            return
        try:
            self.q.put_nowait((frame, t))
        except queue.Full:
            try:
                self.q.get_nowait()
            except queue.Empty:
                pass
            try:
                self.q.put_nowait((frame, t))
            except queue.Full:
                pass
            self.overflows += 1

    # ---- state ---------------------------------------------------------------------------
    def _reset_utt(self):
        self.utt_decided = False
        self.wake_pending = False
        self.ambient = False

    def _drain(self):
        try:
            while True:
                self.q.get_nowait()
        except queue.Empty:
            pass

    def set_state(self, state, tts_text=""):
        if state not in VALID_STATES:
            self.emit("warning", message=f"ignored unknown state {state!r}")
            return
        with self.lock:
            self.state = state
            self.state_t0 = self.audio_t
            self.guard_until = self.audio_t + GUARD.get(state, 0.0)
            if tts_text:
                n = norm_text(tts_text)
                if n:
                    self.tts_ring.append(n)
            self.seg.reset()
            self._reset_utt()
            self._drain()
        self.emit("state_changed", state=state)

    def _to_waiting(self):
        with self.lock:
            self.state = "waiting"  # mute until Electron answers with the next set_state
            self.seg.reset()
            self._reset_utt()
            self._drain()

    def is_echo(self, text):
        t = norm_text(text)
        if not t:
            return False
        for ring in self.tts_ring:
            if f" {t} " in f" {ring} ":
                return True
        return False

    # ---- processing thread ---------------------------------------------------------------
    def run(self):
        while self.running:
            try:
                frame, t = self.q.get(timeout=0.25)
            except queue.Empty:
                continue
            try:
                self.on_frame(frame, t)
                self.errors_in_row = 0
            except Exception as e:  # never die silently: report, reset, carry on
                self.errors_in_row += 1
                log("processing error: " + traceback.format_exc())
                now = time.monotonic()
                if now - self.last_warn > 10:
                    self.last_warn = now
                    self.emit("warning", message=f"audio processing error: {e}")
                self.seg.reset()
                self._reset_utt()
                if self.errors_in_row >= 25:
                    self.emit("error", code="processing_failure", fatal=False,
                              message=f"voice processing keeps failing: {e}", hint="")
                    self.errors_in_row = 0

    def on_frame(self, frame, t):
        self.audio_t = t + len(frame) / SR
        self.last_frame_wall = time.monotonic()
        self._track_mic(frame)
        mode = MODE.get(self.state)
        if mode is None or not self.stt_ready:
            self.seg.reset()
            return
        if self.audio_t < self.guard_until:
            self.seg.reset()
            return
        if mode == "wake":
            self._step_wake(frame, t)
        elif mode == "capture":
            self._step_capture(frame, t)
        else:
            self._step_watch(frame, t)

    def _track_mic(self, frame):
        """All-zero audio means Windows is blocking microphone access (privacy settings) or the device is muted."""
        self.max_abs_window = max(self.max_abs_window, float(np.max(np.abs(frame))) if len(frame) else 0.0)
        if self.window_start == 0.0:
            self.window_start = self.audio_t
        if self.audio_t - self.window_start >= 4.0:
            if self.max_abs_window == 0.0 and not self.silent_reported:
                self.silent_reported = True
                self.emit("mic_silent", message="The microphone delivers only silence",
                          hint="Windows Settings > Privacy & security > Microphone: allow desktop apps; also check the mic is not muted.")
            elif self.max_abs_window > 0.0 and self.silent_reported:
                self.silent_reported = False
                self.emit("mic_recovered", message="Microphone audio is flowing again")
            self.max_abs_window = 0.0
            self.window_start = self.audio_t

    # ---- WAKE ----------------------------------------------------------------------------
    def _step_wake(self, frame, t):
        seg = self.seg
        done = seg.feed(frame, t, end_silence=0.5, max_len=self.cfg.cmd_max)
        if seg.in_speech and not self.utt_decided and seg.duration >= self.cfg.wake_early:
            self.utt_decided = True
            prefix = seg.audio()[: int(self.cfg.wake_early * SR)]
            text = self.stt.transcribe(prefix, "wake", seg.t0)
            ok, _ = match_wake(text)
            if ok and self.is_echo(text):
                ok = False
            self.wake_pending, self.ambient = ok, not ok
            if not ok:
                seg.keep_audio = False
                seg.frames = []
            dbg(f"wake prefix decision={ok}")
        if done is None:
            return
        pending, ambient = self.wake_pending, self.ambient
        self._reset_utt()
        if ambient or done.voiced < 5 or done.duration < 0.3:
            return
        text = self.stt.transcribe(done.audio[: int(15 * SR)], "cmd" if pending else "wake", done.t0)
        self.handle_wake_text(text)

    def handle_wake_text(self, text):
        if not text:
            return
        if self.is_echo(text):
            self.counters["echo_ignored"] += 1
            return
        ok, rest = match_wake(text)
        if not ok:
            self.counters["rejected"] += 1
            dbg("not a wake phrase")
            return
        self.counters["wakes"] += 1
        if rest and match_control(rest):  # "hey neura stop" while idle: nothing to stop
            return
        if rest:
            self.emit("wake_with_command", phrase="hey neura", command=rest, text=text)
        else:
            self.emit("wake", phrase="hey neura", text=text)
        self._to_waiting()

    # ---- CAPTURE -------------------------------------------------------------------------
    def _step_capture(self, frame, t):
        seg = self.seg
        done = seg.feed(frame, t, end_silence=self.cfg.cmd_end_silence, max_len=self.cfg.cmd_max)
        if done is None:
            if not seg.in_speech and self.audio_t - max(self.state_t0, self.guard_until) > self.cfg.listen_timeout:
                self.emit("listen_timeout")
                self._to_waiting()
            return
        if done.voiced < 4 or done.duration < 0.25:
            return
        text = self._clean_cmd(self.stt.transcribe(done.audio, "cmd", done.t0))
        if text:
            self.handle_cmd_text(text)

    @staticmethod
    def _clean_cmd(text):
        n = norm_text(text)
        if not n or n in HALLUCINATIONS:
            return ""
        return text.strip()

    def handle_cmd_text(self, text):
        kind = match_control(text)
        if kind:
            self.emit("stop", kind=kind, phrase=text)
            self._to_waiting()
            return
        ok, rest = match_wake(text)
        if ok:
            if not rest:
                return  # user repeated the wake word; keep listening
            text = rest
        self.emit("command", text=text)
        self._to_waiting()

    # ---- WATCH (stop / cancel / barge-in while Neura is busy or speaking) -------------------
    def _step_watch(self, frame, t):
        seg = self.seg
        done = seg.feed(frame, t, end_silence=0.35, max_len=self.cfg.watch_max)
        if seg.in_speech and seg.duration >= self.cfg.watch_max - 0.05:
            self.ambient = True
        if done is None:
            return
        amb = self.ambient
        self._reset_utt()
        if amb or done.forced or done.voiced < 4 or done.duration < 0.25 or done.peak_rms < self.cfg.watch_min_rms:
            return
        self.handle_watch_text(self.stt.transcribe(done.audio, "wake", done.t0))

    def handle_watch_text(self, text):
        if not text or self.is_echo(text):
            return
        kind = match_control(text)
        if kind:
            self.emit("stop", kind=kind, phrase=text)
            self._to_waiting()
            return
        if self.state == "speaking":
            ok, rest = match_wake(text)
            if ok and not rest:
                self.emit("wake", phrase="hey neura", text=text, barge_in=True)
                self._to_waiting()

    # ---- dev only ------------------------------------------------------------------------
    def emulate(self, text):
        mode = MODE.get(self.state)
        if mode == "wake":
            self.handle_wake_text(text)
        elif mode == "capture":
            self.handle_cmd_text(text)
        elif mode == "watch":
            self.handle_watch_text(text)


# --------------------------------------------------------------------------------------------
# Audio sources
# --------------------------------------------------------------------------------------------
def load_wav(path):
    with wave.open(path, "rb") as w:
        sr, ch, sw = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if sw != 2:
        raise ValueError("only 16-bit PCM wav files are supported")
    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    if sr != SR:
        x = np.arange(0, len(a) * SR / sr) * (sr / SR)
        a = np.interp(x, np.arange(len(a)), a).astype(np.float32)
    return a


class WavSource(threading.Thread):
    """A virtual microphone that plays a wav file through exactly the same queue/VAD/state path as a real mic."""

    def __init__(self, engine, path, speed, on_open, emit_fn=emit):
        super().__init__(daemon=True, name="wav-source")
        self.engine, self.path, self.speed, self.on_open, self.emit = engine, path, speed, on_open, emit_fn
        self.stop_flag = threading.Event()

    def run(self):
        data = load_wav(self.path)
        self.emit("mic_open", device=f"wav:{os.path.basename(self.path)}")
        self.on_open()
        t0 = time.monotonic()
        clock, i = 0.0, 0
        while i < len(data) and not self.stop_flag.is_set():
            frame = data[i:i + FRAME]
            if len(frame) < FRAME:
                frame = np.pad(frame, (0, FRAME - len(frame)))
            self.engine.push(frame, clock, block=True)
            clock += FRAME / SR
            i += FRAME
            delay = clock / self.speed - (time.monotonic() - t0)
            if delay > 0:
                time.sleep(delay)
        self.emit("source_ended")


class MicSource(threading.Thread):
    """Real microphone. Reopens the device after unplugging / sleep / driver hiccups instead of dying quietly."""

    def __init__(self, engine, cfg, on_open, emit_fn=emit):
        super().__init__(daemon=True, name="mic-source")
        self.engine, self.cfg, self.on_open, self.emit = engine, cfg, on_open, emit_fn
        self.stop_flag = threading.Event()
        self.clock = 0.0
        self.last_cb = time.monotonic()
        self.flags = 0

    def _device(self, sd):
        d = self.cfg.device.strip()
        if not d:
            return None
        return int(d) if d.isdigit() else d

    def _callback(self, indata, frames, time_info, status):
        if status:
            self.flags += 1
        self.last_cb = time.monotonic()
        self.engine.push(indata[:, 0].copy(), self.clock)
        self.clock += frames / SR

    def run(self):
        import sounddevice as sd
        backoff, lost = 1.0, False
        while not self.stop_flag.is_set():
            stream = None
            try:
                stream = sd.InputStream(device=self._device(sd), samplerate=SR, channels=1, dtype="float32",
                                        blocksize=FRAME, callback=self._callback)
                stream.start()
                self.last_cb = time.monotonic()
                try:
                    name = sd.query_devices(stream.device)["name"]
                except Exception:
                    name = "default"
                self.engine.mic_ok = True
                self.emit("mic_recovered" if lost else "mic_open", device=name)
                lost, backoff = False, 1.0
                self.on_open()
                while not self.stop_flag.is_set():
                    time.sleep(0.5)
                    if not stream.active:
                        raise RuntimeError("audio stream stopped")
                    if time.monotonic() - self.last_cb > 2.5:
                        raise RuntimeError("microphone stopped delivering audio")
            except Exception as e:
                if self.stop_flag.is_set():
                    break
                lost = True
                self.engine.mic_ok = False
                self.emit("mic_lost", message=str(e),
                          hint="Check that a microphone is connected, enabled and allowed for desktop apps.")
                log(f"mic error: {e}")
            finally:
                try:
                    if stream is not None:
                        stream.close()
                except Exception:
                    pass
            if self.stop_flag.is_set():
                break
            try:  # refresh PortAudio's device list so a newly plugged mic / changed default is seen
                sd._terminate()
                sd._initialize()
            except Exception:
                pass
            self.stop_flag.wait(backoff)
            backoff = min(backoff * 2, 10.0)


# --------------------------------------------------------------------------------------------
# Process plumbing
# --------------------------------------------------------------------------------------------
def acquire_lock(path):
    """Exclusive lock that the OS releases when the process dies: two services can never share the mic."""
    f = open(path, "a+")
    try:
        if os.name == "nt":
            import msvcrt
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        fatal("duplicate_instance", "Another NeuraOS voice service already owns the microphone.",
              "Close other NeuraOS windows / python processes and retry.", exit_code=3)
    return f


def build_stt(cfg: Config):
    spec = os.environ.get("NEURA_STT", "whisper")
    if spec.startswith("scripted:"):
        return ScriptedSTT(spec[len("scripted:"):])
    try:
        import faster_whisper  # noqa: F401
    except ImportError as e:
        fatal("dependency_missing", f"Python package missing: {e}",
              "Run voice\\setup.ps1 to install faster-whisper, sounddevice and numpy.")
    return WhisperSTT(cfg.wake_model, cfg.cmd_model)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=os.environ.get("NEURA_SOURCE", "mic"), help="mic | wav:<file>")
    ap.add_argument("--speed", type=float, default=float(os.environ.get("NEURA_SOURCE_SPEED", "1")))
    args = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    cfg = Config()
    use_mic = not args.source.startswith("wav:")
    if use_mic:
        try:
            import sounddevice  # noqa: F401
        except ImportError as e:
            fatal("dependency_missing", f"Python package missing: {e}",
                  "Run voice\\setup.ps1 (sounddevice was missing from the old requirements).")
        except OSError as e:
            fatal("dependency_missing", f"PortAudio could not be loaded: {e}", "Reinstall with voice\\setup.ps1.")
    stt = build_stt(cfg)
    lock = acquire_lock(os.environ.get("NEURA_LOCK_FILE") or os.path.join(tempfile.gettempdir(), "neuraos-voice.lock"))
    engine = Engine(stt, cfg)
    started = time.monotonic()
    ready_state = {"mic": False, "announced": False}
    exit_evt = threading.Event()

    def maybe_ready():
        if ready_state["mic"] and engine.stt_ready and not ready_state["announced"]:
            ready_state["announced"] = True
            emit("ready", state=engine.state, source=args.source if not use_mic else "mic")

    def on_mic_open():
        ready_state["mic"] = True
        maybe_ready()

    def load_models():
        while engine.running:
            try:
                emit("status", phase="loading_model",
                     message="Loading local speech model (first run downloads it once)…")
                stt.load()
                engine.stt_ready = True
                emit("status", phase="model_ready", message="Speech model loaded")
                maybe_ready()
                return
            except Exception as e:
                emit("error", code="model_unavailable", fatal=False, message=f"Speech model could not be loaded: {e}",
                     hint="The first run needs internet once to download the Whisper model. Retrying every 30 s.")
                time.sleep(30)

    def heartbeat():
        while engine.running:
            emit("heartbeat", state=engine.state, mic_ok=engine.mic_ok, stt_ready=engine.stt_ready,
                 noise=round(engine.seg.noise, 5), threshold=round(engine.seg.thr, 5),
                 level=round(engine.seg.last_rms, 5), queue=engine.q.qsize(), overflows=engine.overflows,
                 frame_age=round(time.monotonic() - engine.last_frame_wall, 2),
                 uptime=round(time.monotonic() - started, 1), counters=dict(engine.counters))
            time.sleep(2.0)

    def stdin_loop():
        while True:
            line = sys.stdin.readline()
            if not line:  # parent died / closed the pipe
                break
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
                action = cmd.get("cmd")
                if action == "exit":
                    break
                elif action == "set_state":
                    engine.set_state(cmd.get("state", "idle"), cmd.get("tts_text", ""))
                elif action == "ping":
                    emit("pong")
                elif action == "emulate":
                    if cfg.allow_emulate:
                        engine.emulate(str(cmd.get("text", "")))
                    else:
                        emit("warning", message="emulate ignored (set NEURA_DEV_EMULATE=1 for development)")
            except Exception as e:
                emit("warning", message=f"bad command: {e}")
        exit_evt.set()

    threads = [threading.Thread(target=engine.run, daemon=True, name="engine"),
               threading.Thread(target=heartbeat, daemon=True, name="heartbeat"),
               threading.Thread(target=load_models, daemon=True, name="stt-loader"),
               threading.Thread(target=stdin_loop, daemon=True, name="stdin")]
    for th in threads:
        th.start()
    if use_mic:
        src = MicSource(engine, cfg, on_mic_open)
    else:
        src = WavSource(engine, args.source[4:], args.speed, on_mic_open)
    src.start()
    emit("status", phase="starting", message="Voice service started")
    exit_evt.wait()
    engine.running = False
    src.stop_flag.set()
    try:
        lock.close()
    except Exception:
        pass
    sys.exit(0)


if __name__ == "__main__":
    main()
