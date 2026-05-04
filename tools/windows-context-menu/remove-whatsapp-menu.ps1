$RegFile = Join-Path $PSScriptRoot "remove-glassbox-whatsapp-menu.reg"

if (!(Test-Path $RegFile)) {
  Write-Error "Registry file not found: $RegFile"
  exit 1
}

reg import $RegFile
Write-Host "GlassBox WhatsApp context menu removed."
