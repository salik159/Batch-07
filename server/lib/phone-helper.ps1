param(
    [Parameter(Mandatory=$true)]
    [string]$Action,
    [string]$Query = "",
    [string]$PhoneNumber = "",
    [string]$DisplayName = ""
)

$ErrorActionPreference = 'Stop'

function Get-PhoneStatus {
    $report = @{
        installed = $false
        connected = $false
        deviceName = ""
        canDial = $false
        contactsDbPath = ""
        error = $null
    }

    try {
        $pkg = Get-AppxPackage -Name Microsoft.YourPhone -ErrorAction SilentlyContinue
        if ($pkg) {
            $report.installed = $true
        } else {
            $report.error = "Windows Phone Link is not installed."
            return $report
        }

        # Find contacts.db
        $dbPattern = [System.IO.Path]::Combine($env:LOCALAPPDATA, 'Packages', 'Microsoft.YourPhone_8wekyb3d8bbwe', 'LocalCache', 'Indexed', '*', 'System', 'Database', 'contacts.db')
        $db = Get-Item $dbPattern -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($db) {
            $report.contactsDbPath = $db.FullName
        }

        # Check WinRT PhoneLine
        Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue
        $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
        
        $null = [Windows.ApplicationModel.Calls.PhoneCallManager, Windows.ApplicationModel.Calls, ContentType=WindowsRuntime]
        $null = [Windows.ApplicationModel.Calls.PhoneLine, Windows.ApplicationModel.Calls, ContentType=WindowsRuntime]

        $asTaskStore = $asTaskGeneric.MakeGenericMethod([Windows.ApplicationModel.Calls.PhoneCallStore])
        $netTaskStore = $asTaskStore.Invoke($null, @([Windows.ApplicationModel.Calls.PhoneCallManager]::RequestStoreAsync()))
        $netTaskStore.Wait(4000) | Out-Null
        $store = $netTaskStore.Result

        if ($store) {
            $asTaskGuid = $asTaskGeneric.MakeGenericMethod([System.Guid])
            $netTaskGuid = $asTaskGuid.Invoke($null, @($store.GetDefaultLineAsync()))
            $netTaskGuid.Wait(4000) | Out-Null
            $lineId = $netTaskGuid.Result

            if ($lineId -and $lineId -ne [System.Guid]::Empty) {
                $asTaskLine = $asTaskGeneric.MakeGenericMethod([Windows.ApplicationModel.Calls.PhoneLine])
                $netTaskLine = $asTaskLine.Invoke($null, @([Windows.ApplicationModel.Calls.PhoneLine]::FromIdAsync($lineId)))
                $netTaskLine.Wait(4000) | Out-Null
                $line = $netTaskLine.Result

                if ($line) {
                    $report.deviceName = $line.DisplayName.Trim()
                    $report.canDial = [bool]$line.CanDial
                    $transport = $line.Transport.ToString()
                    # If transport is Bluetooth and can dial, device is actively connected
                    if ($report.canDial) {
                        $report.connected = $true
                    }
                }
            }
        }

        if (-not $report.connected) {
            # Check Bluetooth device status for diagnostic details
            $bth = Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -like '*iPhone*' } | Select-Object -First 1
            if ($bth) {
                $report.deviceName = $bth.FriendlyName
                $report.error = "iPhone Bluetooth device found ($($bth.Status)), but Phone Link call line is not connected. Make sure Bluetooth is enabled and paired on both iPhone and PC."
            } else {
                $report.error = "No connected iPhone was found in Phone Link or Bluetooth devices."
            }
        }
    } catch {
        $report.error = $_.Exception.Message
    }

    return $report
}

function Invoke-Dial {
    param([string]$Number, [string]$Name)
    $resObj = @{
        ok = $false
        status = ""
        error = $null
    }

    try {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue
        $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
        
        $null = [Windows.ApplicationModel.Calls.PhoneCallManager, Windows.ApplicationModel.Calls, ContentType=WindowsRuntime]
        $null = [Windows.ApplicationModel.Calls.PhoneLine, Windows.ApplicationModel.Calls, ContentType=WindowsRuntime]

        $asTaskStore = $asTaskGeneric.MakeGenericMethod([Windows.ApplicationModel.Calls.PhoneCallStore])
        $netTaskStore = $asTaskStore.Invoke($null, @([Windows.ApplicationModel.Calls.PhoneCallManager]::RequestStoreAsync()))
        $netTaskStore.Wait(4000) | Out-Null
        $store = $netTaskStore.Result

        $asTaskGuid = $asTaskGeneric.MakeGenericMethod([System.Guid])
        $netTaskGuid = $asTaskGuid.Invoke($null, @($store.GetDefaultLineAsync()))
        $netTaskGuid.Wait(4000) | Out-Null
        $lineId = $netTaskGuid.Result

        $asTaskLine = $asTaskGeneric.MakeGenericMethod([Windows.ApplicationModel.Calls.PhoneLine])
        $netTaskLine = $asTaskLine.Invoke($null, @([Windows.ApplicationModel.Calls.PhoneLine]::FromIdAsync($lineId)))
        $netTaskLine.Wait(4000) | Out-Null
        $line = $netTaskLine.Result

        if (-not $line -or -not $line.CanDial) {
            $resObj.error = "iPhone calling line is not ready or does not support dialing."
            return $resObj
        }

        # DialWithResultAsync
        $asTaskDial = $asTaskGeneric.MakeGenericMethod([Windows.ApplicationModel.Calls.PhoneLineDialResult])
        $netTaskDial = $asTaskDial.Invoke($null, @($line.DialWithResultAsync($Number, $Name)))
        $netTaskDial.Wait(6000) | Out-Null
        $dialResult = $netTaskDial.Result

        $statusStr = $dialResult.DialCallStatus.ToString()
        $resObj.status = $statusStr
        if ($statusStr -eq 'Succeeded') {
            $resObj.ok = $true
        } else {
            $resObj.error = "Phone dial status: $statusStr"
        }
    } catch {
        $resObj.error = $_.Exception.Message
    }

    return $resObj
}

switch ($Action.ToLower()) {
    "status" {
        $st = Get-PhoneStatus
        $st | ConvertTo-Json
    }
    "dial" {
        if (-not $PhoneNumber) {
            @{ ok = $false; error = "PhoneNumber is required" } | ConvertTo-Json
        } else {
            $d = Invoke-Dial -Number $PhoneNumber -Name $DisplayName
            $d | ConvertTo-Json
        }
    }
    "open" {
        try {
            Start-Process "ms-phone:" -ErrorAction SilentlyContinue
            @{ ok = $true } | ConvertTo-Json
        } catch {
            @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json
        }
    }
    default {
        @{ ok = $false; error = "Unknown action $Action" } | ConvertTo-Json
    }
}
