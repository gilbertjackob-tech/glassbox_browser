$ErrorActionPreference = "Stop"

$paths = @(
  "Registry::HKEY_CURRENT_USER\Software\Classes\*\shell\GlassBoxWhatsApp",
  "Registry::HKEY_CURRENT_USER\Software\Classes\AllFilesystemObjects\shell\GlassBoxWhatsApp",
  "Registry::HKEY_CLASSES_ROOT\*\shell\GlassBoxWhatsApp"
)

foreach ($path in $paths) {
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
    Write-Host "Removed: $path"
  }
}

try {
  Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
  Start-Process explorer.exe
  Write-Host "Explorer restarted."
} catch {
  Write-Warning "Removed, but Explorer restart failed. Restart Explorer manually."
}

Write-Host "GlassBox WhatsApp context menu removed."