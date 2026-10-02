# Installs the autoharness extension into the GitHub Copilot app (user scope).
$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot 'extension\autoharness'
$base = if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { Join-Path $HOME '.copilot' }
$dest = Join-Path $base 'extensions\autoharness'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $src 'extension.mjs'), (Join-Path $src 'lib.mjs') -Destination $dest -Force
Write-Host "Installed to $dest"
Write-Host "Next: in the Copilot app, ask the agent to run extensions_reload (or restart the app),"
Write-Host "then follow automations\SETUP-PROMPT.md to create the Reflect and Curate automations."
