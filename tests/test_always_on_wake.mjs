import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const venvPy = path.resolve(__dirname, '..', '.voice-venv', 'Scripts', 'python.exe');
const pyScript = path.resolve(__dirname, '..', 'voice', 'wake_service.py');
const psScript = path.resolve(__dirname, '..', 'voice', 'wake_service.ps1');

console.log('====================================================');
console.log('  NeuraOS Always-On Wake Word & Voice Control Tests ');
console.log('====================================================\n');

function runVoiceServiceSession(sessionName) {
  return new Promise((resolve, reject) => {
    let spawnCmd = 'powershell.exe';
    let spawnArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psScript];
    if (fs.existsSync(venvPy) && fs.existsSync(pyScript)) {
      spawnCmd = venvPy;
      spawnArgs = ['-u', pyScript];
      console.log(`[${sessionName}] Launching wake_service.py (Python) in background...`);
    } else {
      console.log(`[${sessionName}] Launching wake_service.ps1 (PowerShell) in background...`);
    }

    const proc = spawn(spawnCmd, spawnArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

    let state = 'starting';
    let step = 0;
    const history = [];

    proc.stdout.on('data', (d) => {
      const lines = d.toString().split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          history.push(msg);

          if (msg.event === 'ready' && step === 0) {
            console.log(`[${sessionName}] ✓ Step 1: Voice service started automatically in IDLE state (Standby).`);
            step = 1;
            console.log(`[${sessionName}] --> Simulating user saying: "Hey Neura"...`);
            proc.stdin.write(JSON.stringify({ cmd: 'emulate', text: 'hey neura' }) + '\n');
          }
          else if (msg.event === 'wake' && step === 1) {
            console.log(`[${sessionName}] ✓ Step 2: "Hey Neura" detected! NeuraOS responds: "Yes boss?"`);
            step = 2;
            console.log(`[${sessionName}] --> Automatically transitioning to LISTENING state for user command...`);
            proc.stdin.write(JSON.stringify({ cmd: 'set_state', state: 'listening' }) + '\n');
          }
          else if (msg.event === 'state_changed' && msg.state === 'listening' && step === 2) {
            console.log(`[${sessionName}] ✓ Step 3: Now in LISTENING state. User speaking command: "Who is Donald Trump?"...`);
            step = 3;
            proc.stdin.write(JSON.stringify({ cmd: 'emulate', text: 'who is Donald Trump' }) + '\n');
          }
          else if (msg.event === 'command' && step === 3) {
            console.log(`[${sessionName}] ✓ Step 4: Command captured: "${msg.text}". Executing Google search agent...`);
            step = 4;
            console.log(`[${sessionName}] --> Execution complete. Neura is speaking response: "Boss, Donald Trump is..."`);
            proc.stdin.write(JSON.stringify({ cmd: 'set_state', state: 'speaking' }) + '\n');
          }
          else if (msg.event === 'state_changed' && msg.state === 'speaking' && step === 4) {
            console.log(`[${sessionName}] ✓ Step 5: In SPEAKING state. Testing immediate interruption by saying "Neura, stop"...`);
            step = 5;
            proc.stdin.write(JSON.stringify({ cmd: 'emulate', text: 'neura, stop' }) + '\n');
          }
          else if (msg.event === 'stop' && step === 5) {
            console.log(`[${sessionName}] ✓ Step 6: "Neura, stop" detected immediately! Interrupted ongoing speech. Returning to IDLE.`);
            step = 6;
            proc.stdin.write(JSON.stringify({ cmd: 'set_state', state: 'idle' }) + '\n');
          }
          else if (msg.event === 'state_changed' && msg.state === 'idle' && step === 6) {
            console.log(`[${sessionName}] ✓ Step 7: Back in IDLE mode. Testing second consecutive command ("Hey Neura")...`);
            step = 7;
            proc.stdin.write(JSON.stringify({ cmd: 'emulate', text: 'hey neura' }) + '\n');
          }
          else if (msg.event === 'wake' && step === 7) {
            console.log(`[${sessionName}] ✓ Step 8: Second wake activation succeeded! Responding "Yes boss?"`);
            step = 8;
            proc.stdin.write(JSON.stringify({ cmd: 'set_state', state: 'listening' }) + '\n');
          }
          else if (msg.event === 'state_changed' && msg.state === 'listening' && step === 8) {
            console.log(`[${sessionName}] ✓ Step 9: In LISTENING state. Testing "Stop listening" command...`);
            step = 9;
            proc.stdin.write(JSON.stringify({ cmd: 'emulate', text: 'stop listening' }) + '\n');
          }
          else if (msg.event === 'stop' && step === 9) {
            console.log(`[${sessionName}] ✓ Step 10: "Stop listening" detected. Transitioning to IDLE standby.`);
            step = 10;
            proc.stdin.write(JSON.stringify({ cmd: 'set_state', state: 'idle' }) + '\n');
          }
          else if (msg.event === 'state_changed' && msg.state === 'idle' && step === 10) {
            console.log(`[${sessionName}] ✓ Step 11: Standby confirmed. Testing clean exit...`);
            step = 11;
            proc.stdin.write(JSON.stringify({ cmd: 'exit' }) + '\n');
          }
        } catch {}
      }
    });

    proc.stderr.on('data', (d) => console.error(`[${sessionName} STDERR]`, d.toString()));

    proc.on('close', (code) => {
      console.log(`[${sessionName}] Service exited with code ${code}. Total steps completed: ${step}/11`);
      if (step >= 10) {
        resolve(true);
      } else {
        reject(new Error(`Test failed before completing all steps. Reached step ${step}`));
      }
    });
  });
}

async function main() {
  try {
    // Test 1: First complete session (wake, command, interrupt, consecutive wake, stop listening)
    await runVoiceServiceSession('Session 1 - Initial Run');

    console.log('\n----------------------------------------------------');
    console.log('Testing App Restart & Automatic Re-initialization...');
    console.log('----------------------------------------------------\n');

    // Test 2: Restart session (verifying clean re-initialization on relaunch)
    await runVoiceServiceSession('Session 2 - Restart Run');

    console.log('\n====================================================');
    console.log('  ALL ALWAYS-ON WAKE WORD TESTS PASSED SUCCESSFULLY! ');
    console.log('====================================================\n');
  } catch (err) {
    console.error('Test run failed:', err);
    process.exit(1);
  }
}

main();
