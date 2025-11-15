param(
  [string]$Email = 'webmaster@wxbooks.cn',
  [string]$BaseUrl = 'http://localhost:8000'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Json($obj) { $obj | ConvertTo-Json -Depth 6 }

Invoke-RestMethod -Uri "$BaseUrl/api/v1/auth/email/send_code" -Method POST -ContentType 'application/json' -Body (Json @{ email=$Email }) | Out-Null
$dev = Invoke-RestMethod -Uri "$BaseUrl/api/v1/auth/email/dev_code?email=$Email" -Method GET
$code = $dev.data.code
if (-not $code) { throw 'dev_code not available' }
$verify = Invoke-RestMethod -Uri "$BaseUrl/api/v1/auth/email/verify_code" -Method POST -ContentType 'application/json' -Body (Json @{ email=$Email; code=$code })
$token = $verify.data.tokens.access_token
if (-not $token) { throw 'no access token' }

$books = Invoke-RestMethod -Uri "$BaseUrl/api/v1/books?limit=1" -Headers @{ Authorization = "Bearer $token" }
$bookId = $books.data.items[0].id
if (-not $bookId) { throw 'no book found' }

$start = Invoke-RestMethod -Uri "$BaseUrl/api/v1/reader/start" -Method POST -ContentType 'application/json' -Headers @{ Authorization = "Bearer $token" } -Body (Json @{ book_id=$bookId; device_id='dev-1' })
$sid = $start.data.session_id
if (-not $sid) { throw 'no session id' }
Write-Output ("SESSION=" + $sid)

Invoke-RestMethod -Uri "$BaseUrl/api/v1/reader/heartbeat" -Method POST -ContentType 'application/json' -Headers @{ Authorization = "Bearer $token" } -Body (Json @{ session_id=$sid; delta_ms=1500; progress=0.33; last_location='epub://ch1#p10' }) | Out-Null
Invoke-RestMethod -Uri "$BaseUrl/api/v1/reader/heartbeat" -Method POST -ContentType 'application/json' -Headers @{ Authorization = "Bearer $token" } -Body (Json @{ session_id=$sid; delta_ms=1200; progress=0.40; last_location='epub://ch1#p12' }) | Out-Null

$progress = Invoke-RestMethod -Uri "$BaseUrl/api/v1/reader/progress" -Headers @{ Authorization = "Bearer $token" }
Write-Output ("PROGRESS=" + ($progress.data | ConvertTo-Json -Depth 6))

Invoke-RestMethod -Uri "$BaseUrl/api/v1/reader/stop" -Method POST -ContentType 'application/json' -Headers @{ Authorization = "Bearer $token" } -Body (Json @{ session_id=$sid }) | Out-Null
Write-Output 'STOPPED'