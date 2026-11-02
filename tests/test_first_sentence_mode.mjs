import { isWebResearchRequest, synthesizeGoogleSearchAnswer } from '../server/lib/web-research-agent.mjs';
import assert from 'assert';

console.log('====================================================');
console.log('  NeuraOS Google Search: First-Sentence Mode Tests  ');
console.log('====================================================\n');

const testCases = [
  {
    question: "Who is the Prime Minister of India?",
    googleContent: `[DIRECT ANSWER]
Narendra Modi
Prime Minister of India since 2014

[KNOWLEDGE PANEL]
Narendra Damodardas Modi is an Indian politician who has been serving as the 14th prime minister of India since May 2014. He previously served as Chief Minister of Gujarat.

[TOP SEARCH SNIPPETS]
The Prime Minister of India is the head of government of the Republic of India.`
  },
  {
    question: "Who is Donald Trump?",
    googleContent: `[AI OVERVIEW]
Donald Trump is an American politician, media personality, and businessman who is the 47th president of the United States. He previously served as the 45th president from 2017 to 2021.

[KNOWLEDGE PANEL]
Donald John Trump is an American politician and businessman who served as the 45th president of the United States from 2017 to 2021 and was elected the 47th president.`
  },
  {
    question: "What is the capital of Japan?",
    googleContent: `[DIRECT ANSWER]
Tokyo
Capital of Japan

[TOP SEARCH SNIPPETS]
Tokyo, officially the Tokyo Metropolis, is the capital of Japan and one of its 47 prefectures. It is the most populous metropolitan area in the world.`
  },
  {
    question: "What is artificial intelligence?",
    googleContent: `[FEATURED SNIPPET]
Artificial intelligence, or AI, is technology that enables computers and machines to simulate human learning, comprehension, problem solving, and decision making capabilities. It encompasses machine learning and deep learning.

[TOP SEARCH SNIPPETS]
Artificial intelligence is the intelligence of machines or software, as opposed to the intelligence of living beings.`
  },
  {
    question: "Who is the CEO of Microsoft?",
    googleContent: `[DIRECT ANSWER]
Satya Nadella
Chief Executive Officer of Microsoft since 2014

[KNOWLEDGE PANEL]
Satya Narayana Nadella is an Indian-American business executive who has been the chairman and CEO of Microsoft since 2014. He joined Microsoft in 1992 succeeding Steve Ballmer.`
  }
];

async function runTests() {
  let passed = 0;

  for (let i = 0; i < testCases.length; i++) {
    const { question, googleContent } = testCases[i];
    console.log(`\nTest ${i + 1}: "${question}"`);

    // 1. Verify routing
    const isRouted = isWebResearchRequest(question);
    assert.strictEqual(isRouted, true, `Question "${question}" must be routed to web research agent`);
    console.log(`  ✓ Route: Verified factual question detected correctly.`);

    // 2. Verify First-Sentence Answer
    const result = await synthesizeGoogleSearchAnswer(question, googleContent);
    const speech = result.speech.trim();

    console.log(`  Spoken Answer: "${speech}"`);

    // Verify exactly one sentence
    const sentenceCount = speech.split(/(?<=[.?!])\s+/).filter(Boolean).length;
    assert.strictEqual(sentenceCount, 1, `Must contain exactly 1 sentence, got ${sentenceCount}`);
    console.log(`  ✓ Sentence Count: Exactly 1 sentence.`);

    // Verify no introductions or filler
    assert.strictEqual(/^boss,?\s*/i.test(speech), false, `Must not start with "Boss,"`);
    assert.strictEqual(/^according to/i.test(speech), false, `Must not start with "According to"`);
    assert.strictEqual(/^i found/i.test(speech), false, `Must not start with "I found"`);
    console.log(`  ✓ Formatting: No introductory filler or prefixes.`);

    // Verify it is not empty and has ending punctuation
    assert.ok(speech.length > 10, 'Answer must not be empty');
    assert.ok(/[.?!]$/.test(speech), 'Answer must end with punctuation');
    console.log(`  ✓ Integrity: Complete grammatical statement.`);

    passed++;
  }

  console.log('\n====================================================');
  console.log(`  ALL ${passed}/${testCases.length} TESTS PASSED PERFECTLY!`);
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('\nTest failed:', err);
  process.exit(1);
});
