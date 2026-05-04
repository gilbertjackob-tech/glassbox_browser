$ErrorActionPreference = "Stop"

$sendScript = Join-Path $PSScriptRoot "send-whatsapp-files.ps1"

if (!(Test-Path -LiteralPath $sendScript -PathType Leaf)) {
  Write-Error "send-whatsapp-files.ps1 not found: $sendScript"
  exit 1
}

function Install-WhatsAppMenuRoot {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BasePath
  )

  if (Test-Path -LiteralPath $BasePath) {
    Remove-Item -LiteralPath $BasePath -Recurse -Force
  }

  New-Item -Path $BasePath -Force | Out-Null
  New-ItemProperty -LiteralPath $BasePath -Name "MUIVerb" -Value "Send to WhatsApp" -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $BasePath -Name "SubCommands" -Value "" -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $BasePath -Name "MultiSelectModel" -Value "Player" -PropertyType String -Force | Out-Null

  $shell = "$BasePath\shell"
  New-Item -Path $shell -Force | Out-Null

  $items = @(
    @{ Key="01Hasnat"; Name="Hasnat (You)"; Chat="Hasnat (You)"; External=$false },
    @{ Key="02Bihi"; Name="Bihi"; Chat="Bihi"; External=$true },
    @{ Key="03Family"; Name="আমাদের পরিবার"; Chat="আমাদের পরিবার"; External=$true },
    @{ Key="04Tasfia"; Name="Tasfia New"; Chat="Tasfia New"; External=$true },
    @{ Key="05Ammu"; Name="Ammu"; Chat="Ammu"; External=$true },
    @{ Key="06Abbu"; Name="Abbu 2"; Chat="Abbu 2"; External=$true }
  )

  foreach ($item in $items) {
    $itemPath = "$shell\$($item.Key)"
    $cmdPath = "$itemPath\command"

    New-Item -Path $itemPath -Force | Out-Null
    New-ItemProperty -LiteralPath $itemPath -Name "MUIVerb" -Value $item.Name -PropertyType String -Force | Out-Null

    New-Item -Path $cmdPath -Force | Out-Null

    if ($item.External) {
      $cmd = "powershell.exe -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$sendScript`" -Chat `"$($item.Chat)`" -AllowExternalSend `"%1`""
    } else {
      $cmd = "powershell.exe -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$sendScript`" -Chat `"$($item.Chat)`" `"%1`""
    }

    Set-Item -LiteralPath $cmdPath -Value $cmd -Force
  }
}

$roots = @(
  "Registry::HKEY_CURRENT_USER\Software\Classes\*\shell\GlassBoxWhatsApp",
  "Registry::HKEY_CURRENT_USER\Software\Classes\AllFilesystemObjects\shell\GlassBoxWhatsApp"
)

foreach ($root in $roots) {
  Install-WhatsAppMenuRoot -BasePath $root
}

Write-Host "Installed: Right-click file -> Show more options -> Send to WhatsApp"

try {
  Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
  Start-Process explorer.exe
  Write-Host "Explorer restarted."
} catch {
  Write-Warning "Installed, but Explorer restart failed. Restart Explorer manually."
}