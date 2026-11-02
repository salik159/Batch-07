/**
 * NeuraOS YouTube Analysis Agent
 * 
 * Handles:
 * 1. Account verification (enforcing salikkamal2007@gmail.com).
 * 2. Channel analytics via YouTube Studio.
 * 3. Video transcript fetching, summarization, timestamp extraction, and Q&A.
 */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { llm } from './ai-provider.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

const YOUTUBE_SYSTEM = `You are the NeuraOS YouTube Analysis Agent.
You analyze YouTube video transcripts and channel metrics to provide thorough, accurate insights.

RULES:
1. Speakable summary: Start with "Boss, here is the analysis of the video..." or a direct answer.
2. Structure:
   - Quick overview / gist (2-3 sentences).
   - Key points / takeaways with timestamps if provided (e.g. "[1:30] Introduction of concept").
   - Detailed answers to specific user questions.
3. Honesty: Use ONLY the supplied transcript text. Never invent points or timestamps. If transcripts or captions are unavailable or incomplete, state that clearly.
4. Keep tone professional, energetic, and concise for TTS speech.`;

export function isYouTubeRequest(command) {
  const c = String(command || '').trim().toLowerCase();
  if (/\b(youtube studio|channel views|subscribers on youtube|youtube analytics|channel analytics|overall views)\b/.test(c)) return true;
  if (/\b(youtube|video|captions?|transcript)\b/.test(c) && /\b(open|search|analyze|summarize|watch|explain|play)\b/.test(c)) return true;
  if (/youtu\.be\/|youtube\.com\//.test(c)) return true;
  return false;
}

/**
 * Fetch transcript via python helper script
 * @param {string} videoUrlOrId 
 * @returns {Promise<{ ok: boolean, text?: string, timestamps?: any[], error?: string, videoId?: string }>}
 */
export async function getYouTubeTranscript(videoUrlOrId) {
  const pythonCandidates = [
    path.join(root, '.voice-venv', 'Scripts', 'python.exe'),
    process.env.VOICE_PYTHON,
    'python'
  ].filter(Boolean);

  const scriptPath = path.join(__dirname, 'youtube-transcript.py');

  for (const py of pythonCandidates) {
    try {
      const output = await new Promise((resolve, reject) => {
        const child = spawn(py, [scriptPath, String(videoUrlOrId)], {
          windowsHide: true,
          env: { ...process.env, PYTHONUTF8: '1' }
        });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => stdout += d.toString());
        child.stderr.on('data', d => stderr += d.toString());
        child.on('error', reject);
        child.on('close', code => {
          if (code !== 0) return reject(new Error(stderr.trim() || stdout.trim() || `Exit code ${code}`));
          try {
            resolve(JSON.parse(stdout.trim()));
          } catch {
            reject(new Error(stdout.trim() || 'Invalid transcript JSON output'));
          }
        });
      });
      return output;
    } catch (e) {
      // try next python candidate
    }
  }

  return { ok: false, error: 'Could not execute YouTube transcript extractor. Ensure python and youtube-transcript-api are installed.' };
}

/**
 * Summarize and analyze YouTube video content from transcript
 * @param {string} videoUrlOrId
 * @param {string} question
 * @returns {Promise<{ speech: string, display: string, ok: boolean, error?: string }>}
 */
export async function analyzeYouTubeVideo(videoUrlOrId, question = '') {
  const res = await getYouTubeTranscript(videoUrlOrId);
  if (!res.ok || !res.text) {
    const err = res.error || 'This video does not have accessible captions or a public transcript.';
    return {
      ok: false,
      speech: `Boss, I could not analyze the video because ${err}`,
      display: `YouTube Analysis Failed: ${err}`,
      error: err
    };
  }

  const prompt = `VIDEO ID: ${res.videoId}
${question ? `USER QUESTION: ${question}` : 'TASK: Provide a comprehensive summary, key takeaways, and key timestamps.'}

TRANSCRIPT:
${res.text.slice(0, 10000)}

${res.timestamps?.length ? `TIMESTAMPS DETECTED:\n${res.timestamps.map(t => `${t.time}: ${t.text}`).join('\n')}` : ''}

Deliver an insightful summary with clear timestamps where appropriate.`;

  try {
    const aiRes = await llm({
      system: YOUTUBE_SYSTEM,
      user: prompt,
      maxTokens: 1200
    });

    const fullText = aiRes.text.trim();
    const display = `${fullText}\n\n--- Transcript Highlights ---\n` + (res.timestamps || []).slice(0, 8).map(t => `[${t.time}] ${t.text}`).join('\n');

    return {
      ok: true,
      speech: fullText,
      display,
      videoId: res.videoId
    };
  } catch (err) {
    const fallbackSummary = `Boss, I extracted the video transcript with ${res.timestamps?.length || 0} milestone timestamps, but AI summarization reported: ${err.message}`;
    return {
      ok: true,
      speech: fallbackSummary,
      display: `${fallbackSummary}\n\n--- Transcript Excerpt ---\n${res.text.slice(0, 1000)}...\n\n--- Transcript Highlights ---\n` + (res.timestamps || []).slice(0, 8).map(t => `[${t.time}] ${t.text}`).join('\n'),
      videoId: res.videoId,
      warning: err.message
    };
  }
}
