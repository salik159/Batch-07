/**
 * NeuraOS Web Research & News Agent
 * 
 * Handles general knowledge, current events, technical topics,
 * multi-source comparisons, summarization, and follow-up queries.
 */
import { llm } from './ai-provider.mjs';
import { fetchCleanWebpage } from './web-extractor.mjs';

const RESEARCH_SYSTEM = `You are the NeuraOS Real-Time Web Research & Intelligence Agent.
Your job is to provide accurate, up-to-date, and concisely spoken answers based on real web data.

RULES:
1. Speakable concise English: Begin with a direct, spoken answer (e.g. "Boss, India's Prime Minister is Narendra Modi." or "Boss, here are today's important AI developments...").
2. Factuality: Use ONLY verified information from the supplied webpage text or news items. Never invent facts, dates, names, or URLs.
3. If information is uncertain or conflicting across sources, note the difference.
4. When explaining technical topics (e.g. Docker), give a simple, clear explanation first, followed by practical key points.
5. Provide a summary suitable for TTS speech (under 4-5 sentences for simple questions, structured points for news/summaries).
6. Format output cleanly. If helpful, include [SOURCES] at the bottom for on-screen reference.`;

export function isWebResearchRequest(command) {
  const c = String(command || '').trim().toLowerCase();
  if (/\b(e-?mail|gmail|inbox)\b/.test(c)) return false;
  if (/\b(write|create|code|program|implement)\b.*\b(java|python|javascript|code|function|class)\b/.test(c)) return false;
  if (/\b(youtube studio|channel views|subscribers on youtube|youtube analytics)\b/.test(c)) return false;
  if (/\b(call|phone)\b\s+([a-z]+)/.test(c)) return false;

  if (/\b(who\s+(?:is|was|are|were|invented|founded|created|discovered|built|directed|wrote|made|leads|runs|owns))\b/.test(c)) return true;
  if (/\b(what\s+(?:is|was|are|were|causes|does|happened))\b/.test(c)) return true;
  if (/\b(where\s+(?:is|was|are|were|can))\b/.test(c)) return true;
  if (/\b(when\s+(?:is|was|did|were))\b/.test(c)) return true;
  if (/\b(why\s+(?:is|was|did|do|does))\b/.test(c)) return true;
  if (/\b(how\s+(?:is|was|did|do|does|many|much|tall|old|far|long|big))\b/.test(c)) return true;
  if (/\b(which\s+(?:is|was|are|were|country|state|city|team))\b/.test(c)) return true;
  if (/\b(capital\s+of|ceo\s+of|founder\s+of|president\s+of|prime\s+minister\s+of)\b/.test(c)) return true;
  if (/\b(who's|what's|where's|when's|why's|how's|tell me about|explain)\b/.test(c)) return true;
  if (/\b(news|latest|happening|headlines|today|current events|market|price of|update on)\b/.test(c)) return true;
  if (/\b(search the web|search for|google for|look up|find out)\b/.test(c)) return true;
  if (/\b(explain more|read the full article|find another source|summarize in five points|open the source)\b/.test(c)) return true;
  return false;
}

export function isFollowUpRequest(command) {
  const c = String(command || '').trim().toLowerCase();
  return /\b(explain more|more details|elaborate|read the full article|find another source|summarize in five points|summarise in 5 points|open the source|open source)\b/.test(c);
}

/**
 * Perform web research synthesis using search results or scraped page text.
 * @param {string} question
 * @param {{ query?: string, title?: string, url?: string, content?: string, sources?: any[] }} context
 * @returns {Promise<{ speech: string, display: string, sources: any[] }>}
 */
export async function synthesizeResearch(question, context = {}) {
  const q = String(question || '').trim();
  const content = context.content || '';
  const sources = context.sources || (context.url ? [{ title: context.title || 'Web Source', url: context.url }] : []);

  const userPrompt = `USER QUESTION: ${q}
${context.query ? `SEARCH QUERY: ${context.query}` : ''}
${context.title ? `PAGE TITLE: ${context.title}` : ''}
${context.url ? `URL: ${context.url}` : ''}

EXTRACTED WEBPAGE CONTENT:
${content ? content.slice(0, 6000) : '(No direct webpage text provided; rely on headlines or search findings)'}

${sources.length ? `AVAILABLE SOURCES:\n${sources.map((s, i) => `${i + 1}. ${s.title || 'Article'} - ${s.url || ''} (${s.source || 'Web'})`).join('\n')}` : ''}

Provide a direct, conversational response starting with "Boss,". Keep it natural, factual, and speakable.`;

  let fullText = '';
  try {
    const aiRes = await llm({
      system: RESEARCH_SYSTEM,
      user: userPrompt,
      maxTokens: 1000
    });
    fullText = aiRes.text.trim();
  } catch (err) {
    const cleanContent = (content || '').trim();
    const firstSentences = cleanContent.slice(0, 300).split(/(?<=[.?!])\s+/).slice(0, 3).join(' ');
    fullText = firstSentences
      ? `Boss, based on the web source: ${firstSentences}`
      : `Boss, I found relevant information online, but AI synthesis reported: ${err.message}`;
  }

  // Create on-screen display text with sources listed
  let display = fullText;
  if (sources.length > 0 && !display.includes('Sources:')) {
    display += `\n\n--- Sources ---\n` + sources.slice(0, 4).map(s => `• ${s.title || s.url} (${s.url})`).join('\n');
  }

  return {
    speech: fullText,
    display,
    sources
  };
}

const GOOGLE_SEARCH_SYSTEM = `You are the NeuraOS First-Sentence Answer Agent.
Your job is to read the visible Google search results page and extract EXACTLY ONE single sentence that answers the user's factual or general knowledge question.

STRICT RULES:
1. EXACTLY ONE SENTENCE: Output ONLY the first relevant answer sentence. Never output multiple sentences.
2. NO INTRODUCTIONS OR FILLER: Do NOT say "Boss,", do NOT say "I found this information", do NOT say "According to Google", do NOT repeat the question.
3. DIRECT FACTUAL STATEMENT: Begin directly with the answer/subject (e.g., "The Prime Minister of India is Narendra Modi." or "The capital of Japan is Tokyo." or "Donald Trump is the 47th president of the United States." or "Artificial intelligence is technology that enables computers to simulate human intelligence and problem-solving capabilities.").
4. STRICTLY FROM GOOGLE RESULTS: Use ONLY the information visibly present in the provided Google search results. Never invent facts.
5. IF UNCLEAR OR NOT FOUND: Output exactly: "I couldn't find a clear answer."`;

function cleanFirstSentence(raw) {
  let text = String(raw || '').trim();
  text = text.replace(/^["'`]+|["'`]+$/g, '');
  text = text.replace(/^(boss,?\s*|according to [^,]+,?\s*|i found [^,]+,?\s*|the answer is:?\s*|here is:?\s*)/i, '');
  
  // Extract strictly the first sentence
  const match = text.match(/^([^.?!]+[.?!])/);
  if (match) {
    text = match[1].trim();
  } else {
    text = text.split(/\r?\n/)[0].trim();
    if (text && !/[.?!]$/.test(text)) text += '.';
  }
  return text || "I couldn't find a clear answer.";
}

function extractFirstAnswerSentenceDirectly(content) {
  if (!content) return "I couldn't find a clear answer.";
  const sections = ['[DIRECT ANSWER]', '[AI OVERVIEW]', '[FEATURED SNIPPET]', '[KNOWLEDGE PANEL]', '[TOP SEARCH SNIPPETS]'];
  for (const sec of sections) {
    const idx = content.indexOf(sec);
    if (idx !== -1) {
      const part = content.slice(idx + sec.length);
      const nextSecIdx = part.search(/\[[A-Z\s]+\]/);
      const block = (nextSecIdx !== -1 ? part.slice(0, nextSecIdx) : part).trim();
      const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 5);
      for (const line of lines) {
        const sentences = line.split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(s => s.length > 15);
        if (sentences.length > 0) {
          const first = sentences[0].replace(/^["'`]+|["'`]+$/g, '').trim();
          if (first) return cleanFirstSentence(first);
        }
      }
    }
  }
  const match = content.match(/([A-Z][^.?!]{15,}[.?!])/);
  if (match) return cleanFirstSentence(match[1].trim());
  return "I couldn't find a clear answer.";
}

/**
 * Synthesizes an answer directly and exclusively from the Google search results page content
 * without navigating away to any external website.
 * Reads ONLY the first relevant answer sentence and speaks only that sentence.
 * @param {string} question
 * @param {string} searchResultsText
 * @returns {Promise<{ speech: string, display: string }>}
 */
export async function synthesizeGoogleSearchAnswer(question, searchResultsText) {
  const q = String(question || '').trim();
  const content = String(searchResultsText || '').trim();

  if (!content || content.length < 15) {
    const fallback = "I couldn't find a clear answer.";
    return {
      speech: fallback,
      display: fallback
    };
  }

  const userPrompt = `USER QUESTION: ${q}

GOOGLE SEARCH RESULTS VISIBLE CONTENT:
${content.slice(0, 6000)}

Extract ONLY the first relevant answer sentence from the Google search results. Output exactly one sentence and nothing else. If no reliable answer is available, output "I couldn't find a clear answer."`;

  let singleSentence = '';
  try {
    const aiRes = await llm({
      system: GOOGLE_SEARCH_SYSTEM,
      user: userPrompt,
      maxTokens: 150
    });
    singleSentence = cleanFirstSentence(aiRes.text);
  } catch (err) {
    // Zero-latency deterministic extraction directly from Google DOM snippets
    singleSentence = extractFirstAnswerSentenceDirectly(content);
  }

  if (!singleSentence || singleSentence.length < 5) {
    singleSentence = "I couldn't find a clear answer.";
  }

  return {
    speech: singleSentence,
    display: `${singleSentence}\n\n--- Google Search Results Excerpt ---\n${content.slice(0, 800)}...`
  };
}
