# NeuraOS — Complete Integrated System

This build integrates **Ollama** as the Primary AI Provider with **Groq** cloud fallback, **Always-On Wake Word Activation ("Hey Neura")**, **Universal Coding Agent in VS Code** (Python, Java, C++, JS, TS, HTML/CSS, SQL), **iPhone Calling via Windows Phone Link**, **Google Search: First-Sentence Answer Mode**, and **YouTube Analysis** under `salikkamal2007@gmail.com`.

---

## Key Features & Architecture

### 1. AI Provider Replacement: Ollama (Primary) & Groq (Cloud Fallback)
- **Primary AI Provider**: Local Ollama server (`http://localhost:11434`), running model `llama3.2:latest`. Completely free, offline, private, zero quota limits, and no API key required.
- **Secondary Cloud Provider**: Groq API (`llama-3.3-70b-versatile`) for high-speed cloud inference. If Groq encounters rate limits (429), it automatically falls back to local Ollama.
- **Eliminated Gemini Dependency**: No more `429 Resource Exhausted` interruptions.
- Configured in `.env`:
  ```env
  AI_PROVIDER=ollama
  OLLAMA_BASE_URL=http://localhost:11434
  OLLAMA_MODEL=llama3.2:latest

  GROQ_API_KEY=
  GROQ_MODEL=llama-3.3-70b-versatile
  GROQ_BASE_URL=https://api.groq.com/openai/v1
  ```

### 2. Always-On Wake Word Activation ("Hey Neura") — Fixed & Verified
- **Root Cause Fixed**: The previous PowerShell-based implementation was blocked inside `[Console]::In.ReadLine()` on the main STA thread, which prevented Windows Speech events from dispatching.
- **New Native Python Service (`voice/wake_service.py`)**:
  - Uses `sounddevice` for continuous direct microphone streaming (Intel Smart Sound Array).
  - Uses in-memory `faster-whisper` (`tiny.en`, int8 CPU) with sub-50ms keyword matching.
  - Non-blocking daemon background thread for stdin/stdout JSON-RPC protocol.
- **Hands-Free Activation Loop**:
  1. NeuraOS starts -> Microphone automatically starts listening in `IDLE` standby.
  2. Say **"Hey Neura"** -> Neura immediately awakens and replies: **"Yes boss?"**
  3. Transitions automatically to `LISTENING` for your command (no button clicks required).
  4. User speaks instruction (e.g., *"Write a Python calculator"* or *"Who is the Prime Minister of India?"*).
  5. NeuraOS executes the appropriate specialist agent, speaks the response aloud, and **automatically returns to `IDLE` wake-word standby**.
- **Instant Interruption & Voice Control**:
  - *"Neura, stop"* or *"Stop speaking"* – Immediately terminates ongoing speech and TTS synthesizer.
  - *"Cancel"* – Cancels active task execution.
  - *"Stop listening"* – Returns to wake-word standby mode.
- **Runs Minimized**: `backgroundThrottling: false` ensures continuous background listening even when NeuraOS is minimized behind other applications.
- **Automated Verification**:
  ```powershell
  npm run test:wake
  ```

### 3. Universal Coding Agent in VS Code
- **Multi-Language Support**:
  - Python (`.py`) — Primary, modern, self-contained
  - Java (`.java`) — Java 17+ compatible with single public class
  - C++ (`.cpp` / `.c`) — Modern C++ with standard entry points
  - JavaScript / TypeScript (`.js` / `.ts`) — Node.js runtime
  - HTML & CSS (`index.html`, `styles.css`) — Frontend / landing pages
  - SQL (`queries.sql`) — Database schemas and queries
- **Meaningful File & Class Naming**: Automatically derives descriptive file names (e.g. `calculator.py`, `StudentManagement.java`, `binary_search.py`, `index.html`) instead of generic placeholders.
- **Auto-Repair Loop**: Automatically tests compilation or syntax; if errors or exceptions occur, it routes the error output back to Ollama to repair and re-run.
- **Safe Execution & Voice Explanation**: Saves code to `Documents\NeuraOS`, opens in VS Code, executes the runnable program, and announces the explanation via voice.

### 4. iPhone Calling Integration (Windows Phone Link)
- **Active iPhone Line Detection**: Communicates with Windows Phone Link via Bluetooth Hands-Free Profile (HFP).
- **Contact Database Matching**: Scans Phone Link's SQLite database (`contacts.db`) for matching contacts.
- **Disambiguation**: If multiple contacts match (e.g., "Krishna" vs "MG.krishna vardhan"), NeuraOS announces the choices and asks for clarification.
- **Honest Calling**: Initiates real phone call via `ApplicationModel.Calls` and announces *"Calling [Name], boss."*

### 5. Google Search: First-Sentence Answer Mode
- **Strict Response Rules**:
  - Reads **strictly the first relevant answer sentence** from Google search results.
  - No filler, no introductory prefixes (no "Boss,", no "I found this"), no repeating the question.
  - Does not open external links or navigate away from Google.
- **Automated Verification**:
  ```powershell
  npm run test:search
  ```

### 6. YouTube Analysis (Account: `salikkamal2007@gmail.com`)
- Target browser profile locks to `salikkamal2007@gmail.com`.
- Preserves cookies and checks account session before opening YouTube Studio.

---

## Automated Verification Suite

Run all verification tests to verify end-to-end functionality:
```powershell
npm test           # Full unit and agent tests (49 passed)
npm run test:wake  # Multi-cycle always-on wake word & interruption test
npm run test:search # Google first-sentence mode verification
npm run typecheck  # TypeScript validation
npm run build      # Vite production build
```

---

## Launching NeuraOS

To run the complete desktop application:
```powershell
npm run desktop
```
