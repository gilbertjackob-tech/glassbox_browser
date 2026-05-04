param(
  [Parameter(Mandatory = $true)]
  [string]$Chat,

  [switch]$AllowExternalSend,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Files
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Path (Split-Path -Path $PSScriptRoot -Parent) -Parent
$cliPath = Join-Path $repoRoot "scripts\glassbox-cli.mjs"

if (!(Test-Path -LiteralPath $cliPath -PathType Leaf)) {
  Write-Error "GlassBox CLI not found: $cliPath"
  exit 1
}

$resolvedFiles = @()

foreach ($file in $Files) {
  if ([string]::IsNullOrWhiteSpace($file)) {
    continue
  }

  if (!(Test-Path -LiteralPath $file -PathType Leaf)) {
    Write-Error "File not found: $file"
    exit 1
  }

  $resolvedFiles += (Resolve-Path -LiteralPath $file).Path
}

if ($resolvedFiles.Count -lt 1) {
  Write-Error "No valid files were provided."
  exit 1
}

$nodeArgs = @(
  $cliPath,
  "whatsapp",
  "send-file",
  "--chat",
  $Chat
)

foreach ($resolvedFile in $resolvedFiles) {
  $nodeArgs += @("--file", $resolvedFile)
}

if ($AllowExternalSend) {
  $nodeArgs += "--allowExternalSend"
}

Push-Location $repoRoot
try {
  Write-Host "GlassBox repo: $repoRoot"
  Write-Host "Chat: $Chat"
  Write-Host "Files:"
  $resolvedFiles | ForEach-Object { Write-Host " - $_" }
  Write-Host ""

  & node @nodeArgs
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}