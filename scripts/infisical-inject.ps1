param(
  [string]$EnvName = "dev",
  [string]$Output = ".env.infisical"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if (Get-Command infisical -ErrorAction SilentlyContinue) {
  infisical export --env $EnvName --format dotenv --output $Output
} else {
  if (Test-Path ".env.local") {
    Copy-Item ".env.local" -Destination $Output -Force
  } else {
    New-Item -ItemType File -Path $Output -Force | Out-Null
  }
}
Write-Output "ENV_FILE=$Output"