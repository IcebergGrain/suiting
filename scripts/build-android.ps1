param(
    [string]$ToolsDirectory = (Join-Path $PSScriptRoot '..\.android-build-tools'),
    [string]$SdkDirectory = $env:ANDROID_SDK_ROOT,
    [switch]$Optimized
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$tools = [IO.Path]::GetFullPath($ToolsDirectory)
if (-not $SdkDirectory) { $SdkDirectory = $env:ANDROID_HOME }
if (-not $SdkDirectory) { $SdkDirectory = Join-Path $tools 'sdk' }
if (-not (Test-Path -LiteralPath (Join-Path $SdkDirectory 'platforms\android-35\android.jar'))) {
    throw 'Install Android SDK platform 35 and build-tools 35.0.0 after reviewing its license, then set ANDROID_SDK_ROOT.'
}
New-Item -ItemType Directory -Force -Path $tools | Out-Null
$env:ANDROID_SDK_ROOT = [IO.Path]::GetFullPath($SdkDirectory)
$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
$env:ANDROID_USER_HOME = Join-Path $tools 'android-user'
$env:GRADLE_USER_HOME = Join-Path $tools 'gradle-user'
$env:SUITING_DEBUG_KEYSTORE = Join-Path $tools 'suiting-public-preview.keystore'
$keytool = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\keytool.exe' } else { 'keytool' }
if (-not (Test-Path -LiteralPath $env:SUITING_DEBUG_KEYSTORE)) {
    & $keytool -genkeypair -keystore $env:SUITING_DEBUG_KEYSTORE -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=SuiTing Public Preview,O=Local Development,C=CN'
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the local test signing key.' }
}
$gradle = Join-Path $tools 'gradle-8.9\bin\gradle.bat'
if (-not (Test-Path -LiteralPath $gradle)) { $gradle = Join-Path $root 'android\gradlew.bat' }
Push-Location (Join-Path $root 'android')
try {
    $variant = if ($Optimized) { 'release' } else { 'debug' }
    $tasks = if ($Optimized) { @(':app:testDebugUnitTest', ':app:lintRelease', ':app:assembleRelease') } else { @(':app:testDebugUnitTest', ':app:lintDebug', ':app:assembleDebug') }
    & $gradle --no-daemon --console=plain @tasks
    if ($LASTEXITCODE -ne 0) { throw 'Android checks or build failed.' }
    Write-Output (Join-Path $root "android\app\build\outputs\apk\$variant\app-$variant.apk")
} finally { Pop-Location }
