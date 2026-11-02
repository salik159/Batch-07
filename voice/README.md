# Local Whisper for NeuraOS

NeuraOS uses faster-whisper locally for speech-to-text. No OpenAI transcription API is required.

## Setup (Windows)
From the NeuraOS root:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\voice\setup.ps1
```

The default model is `base.en`. The model is downloaded once and cached by faster-whisper.

Environment options:
- `LOCAL_WHISPER_MODEL=base.en` (default)
- `LOCAL_WHISPER_MODEL=tiny.en` for lower resource use
- `LOCAL_WHISPER_MODEL=small.en` for higher accuracy
- `VOICE_PYTHON=C:\path\to\python.exe` to choose a specific Python
