param(
  [string]$Email = 'webmaster@wxbooks.cn',
  [string]$ObjectUrl,
  [string]$Title = '测试书籍',
  [string]$Format = 'epub',
  [int]$Size = 0,
  [string]$BaseUrl = 'http://localhost:8000'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Json($obj) { $obj | ConvertTo-Json -Depth 6 }

# 获取验证码并登录
Invoke-RestMethod -Uri "$BaseUrl/api/v1/auth/email/send_code" -Method POST -ContentType 'application/json' -Body (Json @{ email=$Email }) | Out-Null
$dev = Invoke-RestMethod -Uri "$BaseUrl/api/v1/auth/email/dev_code?email=$Email" -Method GET
$code = $dev.data.code
if (-not $code) { throw 'dev_code not available' }
$verify = Invoke-RestMethod -Uri "$BaseUrl/api/v1/auth/email/verify_code" -Method POST -ContentType 'application/json' -Body (Json @{ email=$Email; code=$code })
$token = $verify.data.tokens.access_token
if (-not $token) { throw 'no access token' }

# 注册书籍（使用已上传的对象URL）
if (-not $ObjectUrl) { throw 'ObjectUrl is required' }
$regBody = Json @{ object_url=$ObjectUrl; title=$Title; original_format=$Format; size=$Size }
$reg = Invoke-RestMethod -Uri "$BaseUrl/api/v1/books/register" -Method POST -ContentType 'application/json' -Headers @{ Authorization = "Bearer $token" } -Body $regBody
Write-Output ("REGISTERED=" + ($reg.data | ConvertTo-Json -Depth 6))

# 列出书籍
$books = Invoke-RestMethod -Uri "$BaseUrl/api/v1/books?limit=5" -Headers @{ Authorization = "Bearer $token" }
Write-Output ("BOOKS=" + (Json $books.data))

# 搜索书籍
$search = Invoke-WebRequest -Uri "$BaseUrl/api/v1/search?q=$Title&kind=book&limit=5" -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing
Write-Output ("ENGINE=" + $search.Headers['X-Search-Engine'])
Write-Output ("SEARCH=" + $search.Content)
try {
  Invoke-RestMethod -Uri "$BaseUrl/api/v1/search/reindex_books" -Method POST -Headers @{ Authorization = "Bearer $token" } | Out-Null
} catch {}
Start-Sleep -Seconds 2
$search2 = Invoke-WebRequest -Uri "$BaseUrl/api/v1/search?q=$Title&kind=book&limit=5" -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing
Write-Output ("ENGINE2=" + $search2.Headers['X-Search-Engine'])
Write-Output ("SEARCH2=" + $search2.Content)