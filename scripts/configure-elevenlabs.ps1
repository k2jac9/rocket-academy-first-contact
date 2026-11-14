param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'FIRST CONTACT - ElevenLabs key'
$envPath = Join-Path $ProjectRoot '.env.local'
$statusDirectory = Join-Path $ProjectRoot 'test-results'
$statusPath = Join-Path $statusDirectory 'elevenlabs-key-status.json'
$temporaryPath = $null
$secret = $null
$plain = $null
$pointer = [IntPtr]::Zero

function Write-KeyStatus([string]$State) {
    New-Item -ItemType Directory -Force -Path $statusDirectory | Out-Null
    [IO.File]::WriteAllText($statusPath, (@{ state = $State; updatedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
}

try {
    Write-KeyStatus 'waiting'
    Write-Host ''
    Write-Host 'FIRST CONTACT / ELEVENLABS' -ForegroundColor Cyan
    Write-Host 'Paste your API key below. Its characters will stay hidden.'
    Write-Host 'The key is saved only in this project''s ignored .env.local file.'
    Write-Host 'For narration, enable Text to Speech access and Voices read access.'
    Write-Host ''
    $secret = Read-Host 'ElevenLabs API key' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim()
    if ($plain.StartsWith('ELEVENLABS_API_KEY=')) { $plain = $plain.Substring(19).Trim() }
    if ($plain.Length -ge 2 -and (($plain.StartsWith('"') -and $plain.EndsWith('"')) -or ($plain.StartsWith("'") -and $plain.EndsWith("'")))) {
        $plain = $plain.Substring(1, $plain.Length - 2)
    }
    if ($plain.Length -lt 12 -or $plain.Length -gt 512 -or $plain -match '[\s"''`#]') {
        Write-KeyStatus 'invalid-input'
        Write-Host 'Nothing saved. Paste only the key, without surrounding instructions or whitespace.' -ForegroundColor Yellow
    } else {
        $existing = if (Test-Path -LiteralPath $envPath) { [IO.File]::ReadAllText($envPath) } else { '' }
        $existing = [Regex]::Replace($existing, '(?m)^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=.*\r?\n?', '')
        $updated = $existing.TrimEnd("`r", "`n") + "`r`nELEVENLABS_API_KEY=" + $plain + "`r`n"
        $temporaryPath = Join-Path $ProjectRoot ('.env.local.elevenlabs-' + [Guid]::NewGuid().ToString('N'))
        [IO.File]::WriteAllText($temporaryPath, $updated, [Text.UTF8Encoding]::new($false))
        if (Test-Path -LiteralPath $envPath) {
            # Windows PowerShell 5 converts a null backup filename to an empty
            # string. Use an ignored backup path for the atomic replacement.
            $backupPath = Join-Path $ProjectRoot ('.env.local.elevenlabs-backup-' + [Guid]::NewGuid().ToString('N'))
            [IO.File]::Replace($temporaryPath, $envPath, $backupPath)
            Remove-Item -LiteralPath $backupPath -ErrorAction SilentlyContinue
        }
        else { Move-Item -LiteralPath $temporaryPath -Destination $envPath }
        $temporaryPath = $null
        $updated = $null
        $existing = $null
        Write-KeyStatus 'saved'
        Write-Host ''
        Write-Host 'Key saved. No key was printed or added to Git.' -ForegroundColor Green
        Write-Host 'Account access will be verified by the local API.'
    }
} catch {
    Write-KeyStatus 'failed'
    [IO.File]::WriteAllText((Join-Path $statusDirectory 'elevenlabs-key-error.json'), (@{ exceptionType = $_.Exception.GetType().FullName; line = $_.InvocationInfo.ScriptLineNumber; hresult = $_.Exception.HResult } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    Write-Host 'The key could not be saved. No credential details are printed.' -ForegroundColor Red
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($secret) { $secret.Dispose() }
    $plain = $null
    if ($temporaryPath -and (Test-Path -LiteralPath $temporaryPath)) { Remove-Item -LiteralPath $temporaryPath }
}
Read-Host 'Press Enter to close this window' | Out-Null
