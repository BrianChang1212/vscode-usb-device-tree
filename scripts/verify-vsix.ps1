param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$VsixPath
)

$ErrorActionPreference = 'Stop'
$resolvedPath = (Resolve-Path -LiteralPath $VsixPath).Path
$projectRoot = Split-Path -Parent $PSScriptRoot
$expected = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedPath)
try {
  $manifestEntry = $archive.GetEntry('extension/package.json')
  if ($null -eq $manifestEntry) { throw 'VSIX is missing extension/package.json.' }

  $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
  try {
    $actual = $reader.ReadToEnd() | ConvertFrom-Json
  } finally {
    $reader.Dispose()
  }

  foreach ($field in @('name', 'publisher', 'version', 'main', 'icon')) {
    if ($actual.$field -ne $expected.$field) {
      throw "VSIX $field does not match package.json."
    }
  }

  foreach ($relativePath in @($expected.main, $expected.icon, 'native/bin/win32-x64/usb-topology.exe')) {
    $entryPath = 'extension/' + $relativePath.TrimStart('.', '/', '\').Replace('\', '/')
    $entry = $archive.GetEntry($entryPath)
    if ($null -eq $entry -or $entry.Length -eq 0) {
      throw "VSIX is missing $entryPath."
    }
  }
} finally {
  $archive.Dispose()
}

$hash = (Get-FileHash -LiteralPath $resolvedPath -Algorithm SHA256).Hash
Write-Output "Verified $($expected.publisher).$($expected.name) $($expected.version): $resolvedPath"
Write-Output "SHA256 $hash"
