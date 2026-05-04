$RegFile = Join-Path $PSScriptRoot "add-glassbox-whatsapp-menu.reg"

if (!(Test-Path $RegFile)) {
  Write-Error "Registry file not found: $RegFile"
  exit 1
}

reg import $RegFile
Write-Host "GlassBox WhatsApp context menu installed."
Write-Host "Right-click any file -> Send to WhatsApp"
