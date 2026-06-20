Set-Location -Path $PSScriptRoot
Write-Host "============================================" -ForegroundColor DarkCyan
Write-Host "  NAVIGATOR  -  starting runtime" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Dashboard:  http://localhost:4319" -ForegroundColor Gray
Write-Host "  Guide:      http://localhost:4319/learn.html" -ForegroundColor Gray
Write-Host "============================================" -ForegroundColor DarkCyan
Write-Host "  Keep this window OPEN to keep the server up." -ForegroundColor DarkGray
Write-Host ""
node navigator-server.js
Write-Host ""
Write-Host "[Navigator stopped]" -ForegroundColor Yellow
Read-Host "Press Enter to close"
