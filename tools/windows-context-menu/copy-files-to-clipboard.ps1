param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Files
)

Add-Type -AssemblyName System.Windows.Forms

$collection = New-Object System.Collections.Specialized.StringCollection

foreach ($file in $Files) {
  if ([string]::IsNullOrWhiteSpace($file)) {
    continue
  }

  if (!(Test-Path -LiteralPath $file -PathType Leaf)) {
    Write-Error "File not found: $file"
    exit 1
  }

  $resolved = (Resolve-Path -LiteralPath $file).Path
  [void]$collection.Add($resolved)
}

if ($collection.Count -lt 1) {
  Write-Error "No valid files provided."
  exit 1
}

[System.Windows.Forms.Clipboard]::SetFileDropList($collection)

Write-Output "Copied $($collection.Count) file(s) to clipboard."
