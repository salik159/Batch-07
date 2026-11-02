$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Speech

$engine = $null
$wakeGrammar = $null
$ctrlGrammar = $null
$dictGrammar = $null
$currentState = "idle"

function Send-JsonEvent($obj) {
    try {
        $json = ConvertTo-Json -Compress $obj
        [Console]::Out.WriteLine($json)
    } catch {}
}

function Init-Engine() {
    try {
        if ($global:engine -ne $null) {
            try { $global:engine.RecognizeAsyncCancel(); $global:engine.Dispose(); } catch {}
            $global:engine = $null
        }

        $e = New-Object System.Speech.Recognition.SpeechRecognitionEngine
        $e.SetInputToDefaultAudioDevice()

        # 1. Wake word grammar
        $wakeChoices = New-Object System.Speech.Recognition.Choices
        $wakeChoices.Add([string[]]@(
            "hey neura",
            "hey neuro",
            "hey nora",
            "ok neura",
            "hi neura",
            "neura"
        ))
        $wakeBuilder = New-Object System.Speech.Recognition.GrammarBuilder
        $wakeBuilder.Append($wakeChoices)
        $wGrammar = New-Object System.Speech.Recognition.Grammar($wakeBuilder)
        $wGrammar.Name = "WakeGrammar"

        # 2. Control / Interruption grammar
        $ctrlChoices = New-Object System.Speech.Recognition.Choices
        $ctrlChoices.Add([string[]]@(
            "neura, stop",
            "neura stop",
            "stop speaking",
            "stop listening",
            "stop",
            "cancel",
            "that's enough"
        ))
        $ctrlBuilder = New-Object System.Speech.Recognition.GrammarBuilder
        $ctrlBuilder.Append($ctrlChoices)
        $cGrammar = New-Object System.Speech.Recognition.Grammar($ctrlBuilder)
        $cGrammar.Name = "ControlGrammar"

        # 3. Dictation grammar for freeform commands
        $dGrammar = New-Object System.Speech.Recognition.DictationGrammar
        $dGrammar.Name = "DictationGrammar"

        $e.LoadGrammar($wGrammar)
        $e.LoadGrammar($cGrammar)
        $e.LoadGrammar($dGrammar)

        # Initial state: IDLE
        $wGrammar.Enabled = $true
        $cGrammar.Enabled = $true
        $dGrammar.Enabled = $false

        $global:engine = $e
        $global:wakeGrammar = $wGrammar
        $global:ctrlGrammar = $cGrammar
        $global:dictGrammar = $dGrammar

        Register-ObjectEvent -InputObject $e -EventName "SpeechRecognized" -Action {
            param($sender, $eventArgs)
            if ($eventArgs.Result -eq $null) { return }
            $text = $eventArgs.Result.Text.Trim()
            $confidence = [Math]::Round($eventArgs.Result.Confidence, 2)
            $grammarName = $eventArgs.Result.Grammar.Name

            # Check for Stop / Control commands first
            if ($grammarName -eq "ControlGrammar" -or ($text -match "(?i)\b(neura,?\s*stop|stop\s+speaking|stop\s+listening|stop|cancel|that's\s+enough)\b")) {
                Send-JsonEvent @{
                    event = "stop"
                    phrase = $text
                    confidence = $confidence
                }
                return
            }

            # Check for Wake phrase
            if ($grammarName -eq "WakeGrammar" -or ($text -match "(?i)\b(hey\s+neura|hey\s+neuro|hey\s+nora|ok\s+neura|hi\s+neura|neura)\b")) {
                # Check if command was spoken in same sentence (e.g. 'Hey Neura who is Donald Trump')
                $cmdPart = ""
                if ($text -match "(?i)^(?:hey\s+neura|hey\s+neuro|hey\s+nora|ok\s+neura|hi\s+neura|neura)\s*[:, -]?\s*(.+)$") {
                    $cmdPart = $Matches[1].Trim()
                }

                if ($cmdPart.Length -gt 0) {
                    Send-JsonEvent @{
                        event = "wake_with_command"
                        phrase = "hey neura"
                        command = $cmdPart
                        confidence = $confidence
                    }
                } else {
                    Send-JsonEvent @{
                        event = "wake"
                        phrase = "hey neura"
                        confidence = $confidence
                    }
                }
                return
            }

            # Otherwise, in listening state, it is a freeform command
            if ($text.Length -gt 0) {
                # Save recognized audio WAV if present
                $wavPath = ""
                try {
                    if ($eventArgs.Result.Audio -ne $null) {
                        $tempWav = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "neura_cmd_$([System.Guid]::NewGuid().ToString('N')).wav")
                        $fs = [System.IO.File]::Create($tempWav)
                        $eventArgs.Result.Audio.WriteToWaveStream($fs)
                        $fs.Close()
                        $wavPath = $tempWav
                    }
                } catch {}

                Send-JsonEvent @{
                    event = "command"
                    text = $text
                    audioPath = $wavPath
                    confidence = $confidence
                }
            }
        } | Out-Null

        $e.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
        Send-JsonEvent @{ event = "ready"; state = $global:currentState }
        return $true
    } catch {
        Send-JsonEvent @{ event = "error"; message = "Microphone error: $($_.Exception.Message)" }
        return $false
    }
}

# Start engine
$ok = Init-Engine

# Command loop from STDIN
try {
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($line -eq $null) { break }
        $line = $line.Trim()
        if ($line.Length -eq 0) { continue }

        try {
            $cmd = ConvertFrom-Json $line
            if ($cmd.cmd -eq "exit") {
                break
            }
            if ($cmd.cmd -eq "set_state") {
                $newState = [string]$cmd.state
                $global:currentState = $newState
                if ($global:engine -ne $null) {
                    if ($newState -eq "listening") {
                        if ($global:wakeGrammar) { $global:wakeGrammar.Enabled = $false }
                        if ($global:ctrlGrammar) { $global:ctrlGrammar.Enabled = $true }
                        if ($global:dictGrammar) { $global:dictGrammar.Enabled = $true }
                    } elseif ($newState -eq "speaking" -or $newState -eq "executing" -or $newState -eq "thinking") {
                        if ($global:wakeGrammar) { $global:wakeGrammar.Enabled = $false }
                        if ($global:ctrlGrammar) { $global:ctrlGrammar.Enabled = $true }
                        if ($global:dictGrammar) { $global:dictGrammar.Enabled = $false }
                    } else {
                        # idle
                        if ($global:wakeGrammar) { $global:wakeGrammar.Enabled = $true }
                        if ($global:ctrlGrammar) { $global:ctrlGrammar.Enabled = $true }
                        if ($global:dictGrammar) { $global:dictGrammar.Enabled = $false }
                    }
                }
                Send-JsonEvent @{ event = "state_changed"; state = $global:currentState }
            }
            if ($cmd.cmd -eq "emulate") {
                $phrase = [string]$cmd.text
                if ($phrase.Length -gt 0) {
                    $text = $phrase.Trim()
                    $confidence = 1.0
                    if ($text -match "(?i)\b(neura,?\s*stop|stop\s+speaking|stop\s+listening|stop|cancel|that's\s+enough)\b") {
                        Send-JsonEvent @{
                            event = "stop"
                            phrase = $text
                            confidence = $confidence
                        }
                    } elseif ($text -match "(?i)\b(hey\s+neura|hey\s+neuro|hey\s+nora|ok\s+neura|hi\s+neura|neura)\b") {
                        $cmdPart = ""
                        if ($text -match "(?i)^(?:hey\s+neura|hey\s+neuro|hey\s+nora|ok\s+neura|hi\s+neura|neura)\s*[:, -]?\s*(.+)$") {
                            $cmdPart = $Matches[1].Trim()
                        }
                        if ($cmdPart.Length -gt 0) {
                            Send-JsonEvent @{
                                event = "wake_with_command"
                                phrase = "hey neura"
                                command = $cmdPart
                                confidence = $confidence
                            }
                        } else {
                            Send-JsonEvent @{
                                event = "wake"
                                phrase = "hey neura"
                                confidence = $confidence
                            }
                        }
                    } else {
                        Send-JsonEvent @{
                            event = "command"
                            text = $text
                            confidence = $confidence
                        }
                    }
                }
            }
            if ($cmd.cmd -eq "reconnect") {
                Init-Engine | Out-Null
            }
        } catch {
            Send-JsonEvent @{ event = "error"; message = "Command error: $($_.Exception.Message)" }
        }
    }
} finally {
    try {
        if ($global:engine -ne $null) {
            $global:engine.RecognizeAsyncCancel()
            $global:engine.Dispose()
        }
    } catch {}
}
