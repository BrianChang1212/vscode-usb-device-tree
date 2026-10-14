$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
  throw 'Visual Studio Installer vswhere.exe was not found.'
}

$vsRoot = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsRoot) { throw 'Visual Studio C++ x64 tools are required to build usb-topology.exe.' }
$vcvars = Join-Path $vsRoot 'VC\Auxiliary\Build\vcvarsall.bat'
$source = Join-Path $PSScriptRoot 'usb-topology.cpp'
$outputDirectory = Join-Path $PSScriptRoot 'bin\win32-x64'
$output = Join-Path $outputDirectory 'usb-topology.exe'
$staging = Join-Path $outputDirectory "usb-topology-$PID.build.exe"
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$command = 'call "{0}" x64 >nul && cl.exe /nologo /std:c++17 /EHsc /W4 /DUNICODE /D_UNICODE /O2 /Fe:"{1}" "{2}"' -f $vcvars, $staging, $source
& $env:ComSpec /d /s /c $command
if ($LASTEXITCODE -ne 0) { throw "Native build failed with exit code $LASTEXITCODE." }

try {
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      Move-Item -LiteralPath $staging -Destination $output -Force -ErrorAction Stop
      break
    } catch {
      if ($attempt -eq 5) { throw }
      Start-Sleep -Milliseconds 500
    }
  }
} finally {
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Force }
}
Write-Output $output
