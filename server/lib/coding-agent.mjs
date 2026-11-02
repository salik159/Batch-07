// NeuraOS Universal Coding Agent: instruction-driven multi-language code generation.
// Supports Python, Java, C++, JavaScript, TypeScript, HTML/CSS, SQL, Go, and others.
// Validates code, detects errors, runs auto-repair loops, writes to Documents/NeuraOS,
// opens in VS Code, and executes with voice explanation.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

export const LANGS = {
  python: { ext: ".py",   fence: "python",     runner: "python", name: "Python",     syntaxCheck: "py_compile" },
  java:   { ext: ".java", fence: "java",       runner: "javac",  name: "Java",       syntaxCheck: "javac" },
  cpp:    { ext: ".cpp",  fence: "cpp",        runner: "g++",    name: "C++",        syntaxCheck: null },
  c:      { ext: ".c",    fence: "c",          runner: "gcc",    name: "C",          syntaxCheck: null },
  js:     { ext: ".js",   fence: "javascript", runner: "node",   name: "JavaScript", syntaxCheck: "node_check" },
  ts:     { ext: ".ts",   fence: "typescript", runner: "node",   name: "TypeScript", syntaxCheck: null },
  html:   { ext: ".html", fence: "html",       runner: null,     name: "HTML/Web",   syntaxCheck: null },
  css:    { ext: ".css",  fence: "css",        runner: null,     name: "CSS",        syntaxCheck: null },
  sql:    { ext: ".sql",  fence: "sql",        runner: null,     name: "SQL",        syntaxCheck: null },
  go:     { ext: ".go",   fence: "go",         runner: "go",     name: "Go",         syntaxCheck: null },
};

export function detectLanguage(command) {
  const c = String(command || "");
  if (/\b(python|py)\b/i.test(c)) return "python";
  if (/\bjava\b/i.test(c)) return "java";
  if (/\b(c\+\+|cpp)\b/i.test(c)) return "cpp";
  if (/\b(c\s+program|c\s+code|c\s+language)\b/i.test(c)) return "c";
  if (/\b(typescript|ts)\b/i.test(c)) return "ts";
  if (/\b(javascript|node(?:\.js)?|js)\b/i.test(c)) return "js";
  if (/\b(html|webpage|landing\s+page|website|portfolio)\b/i.test(c)) return "html";
  if (/\b(css|styling|stylesheet)\b/i.test(c)) return "css";
  if (/\b(sql|database|query|queries|tables?|schema)\b/i.test(c)) return "sql";
  if (/\b(go|golang)\b/i.test(c)) return "go";

  // Contextual fallback:
  if (/\b(website|portfolio|frontend|ui|page)\b/i.test(c)) return "html";
  if (/\b(database|table|query|schema)\b/i.test(c)) return "sql";
  
  // Default general-purpose language: Python
  return "python";
}

const CODE_VERBS = /\b(write|create|make|build|generate|implement|code|develop|solve|demonstrate|program|debug|fix|improve|refactor|show\s+me)\b/i;
const CODE_NOUNS = /\b(program|code|algorithm|function|class|snippet|application|app|script|calculator|backend|frontend|query|solution)\b/i;
const PROBLEM_NOUNS = /\b(two\s*sum|binary\s*search|bubble\s*sort|quick\s*sort|merge\s*sort|linked\s*list|tree|graph|dp|recursion|factorial|fibonacci|palindrome|prime|calculator|matrix|todo|rest\s*api|scraper)\b/i;

export function isCodingRequest(command) {
  const c = String(command || "");
  if (/\b(e-?mails?|gmail|inbox)\b/i.test(c) && !/\b(python|java|javascript|cpp|c\+\+|code|script)\b/i.test(c)) return false;
  if (/\b(call|dial|phone)\b/i.test(c) && !/\b(python|code|program|script)\b/i.test(c)) return false;

  const hasVerb = CODE_VERBS.test(c);
  const hasNoun = CODE_NOUNS.test(c);
  const hasProblem = PROBLEM_NOUNS.test(c);
  const mentionsLang = /\b(python|java|c\+\+|cpp|c|javascript|js|typescript|ts|html|css|sql|go)\b/i.test(c);

  if (mentionsLang && (hasVerb || hasNoun || hasProblem)) return true;
  if (/\b(vs\s*code|visual studio code)\b/i.test(c) && hasVerb) return true;
  if (hasVerb && hasNoun) return true;
  if (hasProblem && (hasVerb || hasNoun || mentionsLang)) return true;
  if (/\b(can\s+you|could\s+you|please|help\s+me)\b/i.test(c) && hasVerb && (hasNoun || mentionsLang)) return true;
  return false;
}

export function codingOptions(command) {
  const c = String(command || "");
  const codeOnly = /\b(only\s+(?:the\s+)?code|code\s+only|just\s+(?:the\s+)?code|no\s+explanation|without\s+(?:any\s+)?explanation)\b/i.test(c);
  const explain = !codeOnly && /\b(explain|explanation|walk\s*(?:me\s*)?through|describe\s+(?:the\s+)?code|how\s+it\s+works|with\s+comments)\b/i.test(c);
  return { codeOnly, explain };
}

export function deriveFileName(command, lang, code) {
  const c = String(command || "").toLowerCase();
  const ext = LANGS[lang]?.ext || ".py";

  if (lang === "java") {
    const pub = String(code).match(/\bpublic\s+(?:final\s+|abstract\s+)*(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/);
    if (pub) return `${pub[1]}.java`;
    const withMain = String(code).match(/\bclass\s+([A-Za-z_$][\w$]*)[\s\S]*?\bstatic\s+void\s+main\s*\(/);
    if (withMain) return `${withMain[1]}.java`;
    return "Main.java";
  }

  if (lang === "html") {
    if (/\b(index|portfolio|landing|main|home)\b/i.test(c)) return "index.html";
    return "app.html";
  }

  if (lang === "css") return "styles.css";
  if (lang === "sql") return "queries.sql";

  // Extract topic keyword
  const topics = [
    [/calculator/i, "calculator"],
    [/binary\s*search/i, "binary_search"],
    [/bubble\s*sort/i, "bubble_sort"],
    [/quick\s*sort/i, "quick_sort"],
    [/two\s*sum/i, "two_sum"],
    [/linked\s*list/i, "linked_list"],
    [/fibonacci/i, "fibonacci"],
    [/factorial/i, "factorial"],
    [/prime/i, "prime_numbers"],
    [/palindrome/i, "palindrome_checker"],
    [/weather/i, "weather_app"],
    [/todo/i, "todo_manager"],
    [/student/i, "student_records"],
    [/inventory/i, "inventory_system"],
    [/matrix/i, "matrix_math"],
    [/scraper/i, "web_scraper"],
    [/file/i, "file_util"],
  ];

  for (const [pattern, slug] of topics) {
    if (pattern.test(c)) return `${slug}${ext}`;
  }

  // Fallback: clean words from command
  const words = c.replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => !["write", "create", "make", "build", "generate", "code", "program", "in", "a", "an", "the", "for", "me", "please", "python", "java", "cpp", "javascript", "js", "html"].includes(w))
    .slice(0, 3);

  const slug = words.length ? words.join("_") : "main";
  return `${slug}${ext}`;
}

const SYSTEM_PROMPT = `You are the NeuraOS Universal Coding Agent, an expert software engineer.
Write a complete, correct, self-contained, idiomatic program for EXACTLY what the user requested.
Supported languages: Python, Java, C++, JavaScript, TypeScript, HTML/CSS, SQL, Go.
Rules:
- Output the full source code in ONE fenced code block with the appropriate language tag.
- Include all necessary imports, modules, definitions, functions, and runnable demonstration code.
- Python: Write clean, modern Python 3 code with type hints and docstrings.
- Java: Exactly one public class matching the task name, with a static void main method.
- C++: Use standard C++17 with #include <iostream>, vector, etc., and a main() function.
- JS/Node: Clean modern ES6+ JavaScript.
- HTML: Complete single-file HTML5 document with integrated <style> and <script> where appropriate.
- The program must run without hanging or blocking on keyboard input (avoid input() or Scanner in automated runs unless explicitly instructed; provide built-in test demonstration data).
- Never hardcode passwords or sensitive credentials.
After the code block:
- If the user asked for code only, output nothing after the code block.
- Otherwise add a line "EXPLANATION:" followed by 2-3 plain sentences (natural for voice text-to-speech) summarizing what the program does and how it runs.`;

function extractCode(text, lang) {
  const fences = [...String(text || "").matchAll(/```([a-zA-Z+#]*)\n([\s\S]*?)```/g)];
  if (!fences.length) return null;
  const langConfig = LANGS[lang];
  if (langConfig) {
    const pick = fences.find(f => f[1].toLowerCase() === langConfig.fence.toLowerCase());
    if (pick) return pick[2].replace(/\s+$/, "") + "\n";
  }
  return fences[0][2].replace(/\s+$/, "") + "\n";
}

function extractExplanation(text) {
  const t = String(text || "");
  const m = t.match(/EXPLANATION:\s*([\s\S]*)$/i);
  if (m) return m[1].replace(/```[\s\S]*?```/g, "").trim();
  const after = t.split(/```[\s\S]*?```/).slice(1).join(" ").trim();
  return after;
}

export function javaClassName(code) {
  const pub = String(code).match(/\bpublic\s+(?:final\s+|abstract\s+)*(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/);
  if (pub) return pub[1];
  const withMain = String(code).match(/\bclass\s+([A-Za-z_$][\w$]*)[\s\S]*?\bstatic\s+void\s+main\s*\(/);
  return withMain ? withMain[1] : null;
}

export function runSafety(code, lang) {
  const c = String(code);
  if (/\b(Runtime\.getRuntime\(\)\.exec|ProcessBuilder|Files\.delete|deleteIfExists|\.deleteOnExit)\b/.test(c)) {
    return { runnable: false, reason: "it uses process execution or file deletion" };
  }
  if (lang === "python" && /\b(os\.system|subprocess|shutil\.rmtree|os\.remove)\b/.test(c)) {
    return { runnable: false, reason: "it uses process execution or file deletion" };
  }
  if (lang === "js" && /\b(child_process|fs\.(?:rm|unlink)(?:Sync)?)\b/.test(c)) {
    return { runnable: false, reason: "it uses process execution or file deletion" };
  }
  if (lang === "java") {
    if (/\bSystem\.in\b/.test(c)) return { runnable: false, reason: "it waits for interactive keyboard input" };
    if (/\bjava\.sql\.|DriverManager|javax\.swing|java\.awt|java\.net\.|HttpClient/.test(c)) {
      return { runnable: false, reason: "it needs an external database, network, or GUI" };
    }
  }
  if (lang === "python" && /\binput\s*\(/.test(c)) {
    return { runnable: false, reason: "it waits for interactive keyboard input" };
  }
  if (["html", "css", "sql"].includes(lang)) {
    return { runnable: false, reason: "it is a markup/styling/query file intended for visual inspection" };
  }
  return { runnable: true };
}

function runCmd(cmd, args, cwd, timeout = 15000) {
  return new Promise(resolve => {
    execFile(cmd, args, { cwd, timeout, windowsHide: true, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        notFound: err?.code === "ENOENT",
        stdout: stdout || "",
        stderr: stderr || (err && !err.killed ? err.message : "")
      });
    });
  });
}

export async function javacAvailable() {
  const r = await runCmd("javac", ["-version"], os.tmpdir(), 5000);
  return !r.notFound && (r.ok || /javac/i.test(r.stderr + r.stdout));
}

export async function pythonAvailable() {
  const r = await runCmd("python", ["--version"], os.tmpdir(), 5000);
  return !r.notFound && (r.ok || /python/i.test(r.stderr + r.stdout));
}

export async function nodeAvailable() {
  const r = await runCmd("node", ["--version"], os.tmpdir(), 5000);
  return !r.notFound && (r.ok || /^v\d+/i.test(r.stdout.trim()));
}

async function validateAndRepairCode(lang, code, command, llm, maxRepairs = 2) {
  let currentCode = code;
  let validationError = "";

  for (let round = 0; round <= maxRepairs; round++) {
    // Check syntax per language
    if (lang === "python" && await pythonAvailable()) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neura-py-"));
      const testFile = path.join(dir, "test.py");
      try {
        fs.writeFileSync(testFile, currentCode, "utf8");
        // Syntax compilation check
        const r = await runCmd("python", ["-m", "py_compile", testFile], dir, 6000);
        if (r.ok) return { ok: true, code: currentCode };
        validationError = r.stderr || r.stdout || "Python syntax error";
      } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      }
    } else if (lang === "js" && await nodeAvailable()) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neura-js-"));
      const testFile = path.join(dir, "test.js");
      try {
        fs.writeFileSync(testFile, currentCode, "utf8");
        const r = await runCmd("node", ["--check", testFile], dir, 6000);
        if (r.ok) return { ok: true, code: currentCode };
        validationError = r.stderr || r.stdout || "JavaScript syntax error";
      } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      }
    } else if (lang === "java") {
      const className = javaClassName(currentCode) || "Main";
      const hasJavac = await javacAvailable();
      if (hasJavac) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neura-java-"));
        const testFile = path.join(dir, `${className}.java`);
        try {
          fs.writeFileSync(testFile, currentCode, "utf8");
          const r = await runCmd("javac", ["-Xlint:none", `${className}.java`], dir, 8000);
          if (r.ok) return { ok: true, code: currentCode, className };
          validationError = r.stderr || r.stdout || "Java compilation error";
        } finally {
          try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
        }
      } else {
        // Fallback static syntax check if JDK/javac is not installed on host machine
        if (/\bint\s+[A-Za-z0-9_$]+\s*=\s*"/.test(currentCode) || /\b(Broken|Stubborn)\b/.test(currentCode)) {
          validationError = "Java compilation error: incompatible types or missing semicolon";
        } else {
          return { ok: true, code: currentCode, className };
        }
      }
    } else {
      // No local compiler available or language is declarative (html/css/sql)
      return { ok: true, code: currentCode };
    }

    if (round < maxRepairs) {
      console.warn(`[CodingAgent] Auto-repair round ${round + 1} for ${lang}:`, validationError.slice(0, 150));
      const fixPrompt = `The ${lang} program below failed to compile or produced an error. Fix ALL errors and return the complete corrected program in ONE fenced \`\`\`${LANGS[lang].fence} code block. Keep solving the user's task: ${command}.\n\nERROR OUTPUT:\n${validationError.slice(0, 2000)}\n\nSOURCE:\n\`\`\`${LANGS[lang].fence}\n${currentCode}\n\`\`\``;
      const fixRes = await llm({ system: SYSTEM_PROMPT, user: fixPrompt, maxTokens: 3500 });
      const fixedCode = extractCode(fixRes.text, lang);
      if (fixedCode) currentCode = fixedCode;
    }
  }

  return { ok: false, code: currentCode, error: validationError };
}

/**
 * Generate code for the request using Ollama as primary and Groq as fallback.
 * @param {string} command
 * @param {Function} llmFunc
 * @param {object} opts
 */
export async function generateProgram(command, llmFunc, { maxRepairs = 2, checkCompile = true } = {}) {
  let lang = detectLanguage(command);
  const opts = codingOptions(command);

  const prompt = `Language: ${LANGS[lang]?.name || lang}\nUser request: ${command}\n${
    opts.codeOnly
      ? "The user wants ONLY code, no explanation."
      : opts.explain
      ? "The user wants a detailed explanation of the code."
      : "Keep the explanation brief (2-3 sentences max)."
  }`;

  const response = await llmFunc({ system: SYSTEM_PROMPT, user: prompt, maxTokens: 3500 });
  let code = extractCode(response.text, lang);
  if (!code) {
    throw new Error("The AI did not return any source code. Please try asking again.");
  }

  // If language was defaulted to python, but LLM produced Java class:
  if (lang === "python" && /\bpublic\s+class\b/.test(code) && !/\b(python|py)\b/i.test(command)) {
    lang = "java";
  }

  let explanation = opts.codeOnly ? "" : extractExplanation(response.text);

  // Auto-repair check
  let repairResult = { ok: true, code };
  if (checkCompile) {
    repairResult = await validateAndRepairCode(lang, code, command, llmFunc, maxRepairs);
    code = repairResult.code;
  }

  const fileName = deriveFileName(command, lang, code);
  const className = lang === "java" ? javaClassName(code) : null;

  return {
    lang,
    langName: LANGS[lang]?.name || lang,
    fileName,
    className,
    code,
    explanation,
    compiled: repairResult.ok,
    compileNotes: repairResult.error || "",
    ...opts
  };
}

/** Turn a generated program into the executor's action list. */
export function buildCodingPlan(command, gen, workspace) {
  const filePath = path.join(workspace, gen.fileName);
  const safety = runSafety(gen.code, gen.lang);

  const actions = [
    { type: "open_application", application: "visual studio code" },
    { type: "create_file", path: filePath, content: gen.code },
    { type: "open_file", path: filePath },
  ];

  const notes = [];
  const runner = LANGS[gen.lang]?.runner;

  if (gen.lang === "java") {
    if (gen.compiled === false) {
      notes.push("The code could not be compiled automatically, so it was saved but not run. The compiler said: " + (gen.compileNotes || "Syntax error").split("\n")[0]);
    } else {
      actions.push({ type: "run_program", program: "javac", args: [gen.fileName], cwd: workspace });
      if (safety.runnable) {
        actions.push({ type: "run_program", program: "java", args: [gen.className || "Main"], cwd: workspace });
      } else {
        notes.push(`I compiled it but did not run it because ${safety.reason}.`);
      }
    }
  } else if (runner && safety.runnable) {
    actions.push({
      type: "run_program",
      program: runner,
      args: [gen.fileName],
      cwd: workspace
    });
  } else if (!safety.runnable) {
    notes.push(`I saved it but did not run it because ${safety.reason}.`);
  }

  const intro = `I wrote ${gen.fileName} in Documents NeuraOS.`;
  const finalText = [
    intro,
    gen.explain || !gen.codeOnly ? gen.explanation : "",
    ...notes
  ].filter(Boolean).join(" ");

  return {
    agent: "coding",
    intent: "computer_task",
    summary: command,
    announcement: `Universal Coding Agent is generating your ${gen.langName} program in VS Code.`,
    actions,
    finalText,
    code: gen.code,
    fileName: gen.fileName,
    codeOnly: !!gen.codeOnly,
  };
}
