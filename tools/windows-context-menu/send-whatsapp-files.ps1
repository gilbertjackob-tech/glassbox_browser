param(
  [Parameter(Mandatory = $true)]
  [string]$Chat,

  [switch]$AllowExternalSend,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Files
)

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

$filesJson = $resolvedFiles | ConvertTo-Json -Compress
$args = @(
  $cliPath,
  'whatsapp',
  'send-file',
  '--chat', $Chat,
  '--files-json', $filesJson
)

if ($AllowExternalSend) {
  $args += '--allowExternalSend'
}

& node @args
exit $LASTEXITCODE
