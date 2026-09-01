# Add pack bin (fast-cli / fast / fast-ink) to the current user's PATH.
# Desktop dir pack has no installer — run this after unpack.
#   powershell -ExecutionPolicy Bypass -File scripts/install-path-shims.ps1 -Src release\cli\bin
param(
	[Parameter(Mandatory = $true)][string]$Src,
	[string]$Dest
)
$ErrorActionPreference = 'Stop'
$src = (Resolve-Path -LiteralPath $Src).Path
$names = @('fast-cli.bat', 'fast.bat', 'fast-ink.bat')
foreach ($n in $names) {
	$p = Join-Path $src $n
	if (-not (Test-Path -LiteralPath $p)) { throw "missing $p" }
}
$linkRoot = $src
if ($Dest) {
	New-Item -ItemType Directory -Force -Path $Dest | Out-Null
	$linkRoot = (Resolve-Path -LiteralPath $Dest).Path
	foreach ($n in $names) {
		Copy-Item -LiteralPath (Join-Path $src $n) -Destination (Join-Path $linkRoot $n) -Force
		Write-Host "copied $(Join-Path $linkRoot $n)"
	}
}
$norm = $linkRoot.TrimEnd('\')
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $userPath) { $userPath = '' }
$parts = @(
	$userPath -split ';' |
		Where-Object { $_ -and ($_.TrimEnd('\') -ne $norm) }
)
$newPath = ($norm + ';' + ($parts -join ';')).TrimEnd(';')
[Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
$env:Path = $norm + ';' + $env:Path
Write-Host "user PATH += $norm  (fast-cli, fast, fast-ink)"
Write-Host "open a new terminal for PATH to apply"
