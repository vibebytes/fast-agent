# Add or remove the desktop shim dir from the current user's PATH.
# Called from installer.nsh (embedded). Same names as macOS postinstall.
param(
	[Parameter(Mandatory = $true)][ValidateSet('Add', 'Remove')][string]$Mode,
	[Parameter(Mandatory = $true)][string]$Dir
)
$ErrorActionPreference = 'Stop'
$norm = $Dir.TrimEnd('\')
if ($Mode -eq 'Add') {
	foreach ($n in @('fast-cli.bat', 'fast.bat', 'fast-ink.bat')) {
		$p = Join-Path $norm $n
		if (-not (Test-Path -LiteralPath $p)) { throw "missing $p" }
	}
}
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $userPath) { $userPath = '' }
$parts = @(
	$userPath -split ';' |
		Where-Object { $_ -and ($_.TrimEnd('\') -ne $norm) }
)
if ($Mode -eq 'Add') {
	$newPath = ($norm + ';' + ($parts -join ';')).TrimEnd(';')
} else {
	$newPath = ($parts -join ';')
}
[Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
