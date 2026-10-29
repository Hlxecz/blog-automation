param([switch]$NoBrowser)

& (Join-Path $PSScriptRoot 'windows/Start-Web.ps1') -NoBrowser:$NoBrowser
