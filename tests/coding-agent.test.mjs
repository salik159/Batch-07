import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { startMock } from "./mock-openai.mjs";
import { isCodingRequest, detectLanguage } from "../server/lib/coding-agent.mjs";

let mock, api, port = 18081, home;
async function plan(command) {
  const r = await fetch(`http://127.0.0.1:${port}/api/agent/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command }) });
  return { status: r.status, body: await r.json() };
}
before(async () => {
  mock = await startMock();
  home = fs.mkdtempSync(path.join(os.tmpdir(), "neura-home-"));
  api = spawn(process.execPath, ["server/server.mjs"], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      AI_PROVIDER: "ollama",
      OLLAMA_BASE_URL: `http://127.0.0.1:${mock.port}`,
      OLLAMA_MODEL: "mock-model",
      HOME: home,
      USERPROFILE: home
    },
    stdio: "ignore"
  });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error("server did not start");
});
after(() => { api?.kill(); mock?.server.close(); });

const PROMPTS = [
  ["Write a Java program to check whether a number is prime.", "PrimeChecker", /prime/],
  ["Now write a Java program to implement binary search.", "BinarySearchDemo", /Index of 7: 3/],
  ["Create a Java program demonstrating multilevel inheritance.", "MultilevelInheritance", /Puppy weeps/],
  ["Hey Neura write a Java program for factorial", "FactorialDemo", /10! = 3628800/],
  ["Solve the Two Sum problem in Java.", "TwoSum", /\[0, 1\]/],
  ["Implement a linked list in Java", "SimpleLinkedList", /1 2 3/],
  ["Create a Java calculator using switch statements.", "SwitchCalculator", /10.0 4.0/],
];

test("intent detection", () => {
  assert.equal(detectLanguage("write java"), "java");
  assert.equal(detectLanguage("write javascript"), "js");
  for (const [p] of PROMPTS) assert.ok(isCodingRequest(p), p);
  assert.ok(isCodingRequest("Create a Java program to connect to MySQL using JDBC."));
  assert.ok(!isCodingRequest("read my latest email"));
  assert.ok(!isCodingRequest("search youtube for java tutorials"));
  assert.ok(!isCodingRequest("open the browser and search for GPU"));
});

test("different instructions produce different, compilable, correct Java (no hardcoded example)", async () => {
  const seen = new Set();
  for (const [prompt, cls, expectOut] of PROMPTS) {
    const { status, body } = await plan(prompt);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.agent, "coding");
    const file = body.actions.find(a => a.type === "create_file");
    assert.equal(path.basename(file.path), `${cls}.java`);
    assert.ok(!seen.has(file.content), "duplicate program returned for different request");
    seen.add(file.content);
    assert.ok(!/reverse|rev\s*=/i.test(file.content) || /reverse/i.test(prompt), "reverse-number leakage");
    // compile + run the generated code for real if JDK is available
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neura-t-"));
    fs.writeFileSync(path.join(dir, `${cls}.java`), file.content);
    let hasJdk = false;
    try { execFileSync("javac", ["-version"], { stdio: "ignore" }); hasJdk = true; } catch {}
    if (hasJdk) {
      execFileSync("javac", [`${cls}.java`], { cwd: dir });
      const out = execFileSync("java", [cls], { cwd: dir, encoding: "utf8" });
      assert.match(out, expectOut, `${cls} output: ${out}`);
    }
    const progs = body.actions.filter(a => a.type === "run_program").map(a => a.program);
    assert.deepEqual(progs, ["javac", "java"]);
  }
  assert.equal(seen.size, PROMPTS.length);
});

test("the user's wording reaches the LLM (instruction-based)", () => {
  const joined = mock.calls.map(c => c.user).join("\n");
  assert.match(joined, /binary search/i); assert.match(joined, /multilevel inheritance/i);
});

test("JDBC program is generated and compiled but NOT auto-run", async () => {
  const { body } = await plan("Create a Java program to connect to MySQL using JDBC.");
  assert.equal(body.agent, "coding");
  assert.ok(/DriverManager/.test(body.actions.find(a => a.type === "create_file").content));
  assert.deepEqual(body.actions.filter(a => a.type === "run_program").map(a => a.program), ["javac"]);
  assert.match(body.finalText, /did not run it/);
});

test("compile error triggers an LLM repair loop", async () => {
  const { body } = await plan("Write a Java program, syntax error test");
  assert.equal(body.agent, "coding");
  const file = body.actions.find(a => a.type === "create_file");
  assert.match(file.content, /"fixed"/);
  assert.ok(mock.calls.some(c => /failed to compile/i.test(c.user)));
});

test("unfixable code is saved but not run, and the reason is reported", async () => {
  const { body } = await plan("Write a Java program, stubborn");
  assert.equal(body.actions.filter(a => a.type === "run_program").length, 0);
  assert.match(body.finalText, /could not be compiled/);
});

test("'code only' returns only code; 'explain' includes an explanation", async () => {
  const only = (await plan("Write a Java program for factorial, code only")).body;
  assert.equal(only.codeOnly, true); assert.ok(only.code.includes("class FactorialDemo")); assert.ok(!/EXPLANATION/.test(only.code));
  const exp = (await plan("Write a Java program for factorial and explain it")).body;
  assert.match(exp.finalText, /This program is FactorialDemo/);
});

test("without Gemini API key and with Gemini provider selected, the agent fails honestly", async () => {
  const p2 = 18082;
  const s = spawn(process.execPath, ["server/server.mjs"], {
    env: {
      ...process.env,
      PORT: String(p2),
      HOST: "127.0.0.1",
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: ""
    },
    stdio: "ignore"
  });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${p2}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const r = await fetch(`http://127.0.0.1:${p2}/api/agent/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: "Write a Java program to check prime" }) });
    const d = await r.json();
    assert.equal(r.status, 502); assert.match(d.error, /GEMINI_API_KEY/i);
  } finally { s.kill(); }
});

test("planner-invented actions like coding_ai_generate are re-routed to the Coding Agent (no 'Blocked action')", async () => {
  const { status, body } = await plan("unknown-action-test please do the prime thing");
  assert.equal(status, 200); assert.equal(body.agent, "coding");
  assert.ok(!JSON.stringify(body.actions).includes("coding_ai_generate"));
  assert.ok(body.actions.some(a => a.type === "create_file" && /isPrime/.test(a.content)));
});
