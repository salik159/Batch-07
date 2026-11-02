import { llm } from '../server/lib/ai-provider.mjs';

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
  // Remove markdown quotes, formatting, or prefixes
  text = text.replace(/^["'`]+|["'`]+$/g, '');
  text = text.replace(/^(boss,?\s*|according to [^,]+,?\s*|i found [^,]+,?\s*|the answer is:?\s*|here is:?\s*)/i, '');
  
  // Extract strictly the first sentence
  const match = text.match(/^([^.?!]+[.?!])/);
  if (match) {
    text = match[1].trim();
  } else {
    // If no ending punctuation, take first line and append period
    text = text.split(/\r?\n/)[0].trim();
    if (text && !/[.?!]$/.test(text)) text += '.';
  }
  return text || "I couldn't find a clear answer.";
}

const tests = [
  {
    q: "Who is the Prime Minister of India?",
    results: `Search Results for 'Who is the Prime Minister of India?':
[DIRECT ANSWER]
Narendra Modi
Prime Minister of India since 2014

[KNOWLEDGE PANEL]
Narendra Damodardas Modi is an Indian politician who has been serving as the 14th prime minister of India since May 2014. He previously served as Chief Minister of Gujarat.`
  },
  {
    q: "Who is Donald Trump?",
    results: `Search Results for 'Who is Donald Trump?':
[AI OVERVIEW]
Donald Trump is an American politician, media personality, and businessman who is the 47th president of the United States. He previously served as the 45th president from 2017 to 2021.`
  },
  {
    q: "What is the capital of Japan?",
    results: `Search Results for 'What is the capital of Japan?':
[DIRECT ANSWER]
Tokyo
Capital of Japan

[TOP SEARCH SNIPPETS]
Tokyo, officially the Tokyo Metropolis, is the capital of Japan and one of its 47 prefectures. It is the most populous metropolitan area in the world.`
  },
  {
    q: "What is artificial intelligence?",
    results: `Search Results for 'What is artificial intelligence?':
[FEATURED SNIPPET]
Artificial intelligence, or AI, is technology that enables computers and machines to simulate human learning, comprehension, problem solving, and decision making capabilities. It encompasses machine learning and deep learning.`
  },
  {
    q: "Who is the CEO of Microsoft?",
    results: `Search Results for 'Who is the CEO of Microsoft?':
[DIRECT ANSWER]
Satya Nadella
Chief Executive Officer of Microsoft since 2014

[KNOWLEDGE PANEL]
Satya Narayana Nadella is an Indian-American business executive who has been the chairman and CEO of Microsoft since 2014. He joined Microsoft in 1992.`
  }
];

async function run() {
  for (const t of tests) {
    console.log(`\n================================`);
    console.log(`Question: ${t.q}`);
    const userPrompt = `USER QUESTION: ${t.q}

GOOGLE SEARCH RESULTS VISIBLE CONTENT:
${t.results}

Extract ONLY the first relevant answer sentence from the search results. Output exactly one sentence and nothing else. If no clear answer is found, output "I couldn't find a clear answer."`;

    const res = await llm({
      system: GOOGLE_SEARCH_SYSTEM,
      user: userPrompt,
      maxTokens: 150
    });
    const cleaned = cleanFirstSentence(res.text);
    console.log(`Raw: ${res.text}`);
    console.log(`Final Spoken Sentence: "${cleaned}"`);
  }
}

run();
