import json
import sys
from faster_whisper import WhisperModel


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: transcribe.py <audio-file> [model]")
    audio_path = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "base.en"
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        audio_path,
        language="en",
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    print(json.dumps({"text": text, "language": info.language, "model": model_name}, ensure_ascii=False))


if __name__ == "__main__":
    main()
