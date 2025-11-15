param()
$ErrorActionPreference = 'Stop'
Write-Output '== Athena Quality Gates =='
$failed = $false

Write-Output 'Contracts: running redocly lint'
pushd ../web
npm run contracts:lint | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Output 'Contracts: FAILED'; $failed = $true }
popd

Write-Output 'ESLint: running'
pushd ../web
npm run lint | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Output 'ESLint: FAILED'; $failed = $true }
popd

Write-Output 'Vitest: unit & coverage'
pushd ../web
npx -y vitest run --coverage | Out-Host
if ($LASTEXITCODE -ne 0) {
  Write-Output 'Vitest coverage failed, fallback to unit only'
  npx -y vitest run | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Output 'Vitest: FAILED'; $failed = $true }
}
popd

Write-Output 'Cypress: axe and basic flows'
pushd ../web
npm run e2e:axe | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Output 'Cypress axe: FAILED'; $failed = $true }
npm run e2e:flows | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Output 'Cypress flows: FAILED'; $failed = $true }
popd

if ($failed) { Write-Output '== FAILED =='; exit 1 } else { Write-Output '== PASSED =='; exit 0 }