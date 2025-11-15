param(
  [string]$BookId,
  [string]$ApiBase = "http://localhost:8000",
  [string]$Token
)

if (-not $Token) {
  Write-Error "Missing Token"
  exit 1
}

$headers = @{ Authorization = "Bearer $Token" }

# Download inside calibre container and convert
$id = [guid]::NewGuid().ToString()
$input = "/books/input-$id"
$output = "/books/output-$id.epub"
# Host download then copy into container
# Ask API for internal presign GET
$src = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/v1/books/$BookId/presign_get_source" -Headers $headers -ContentType "application/json"
$getUrl = $src.data.get_url
# Download inside container and convert
docker compose exec -T calibre /bin/sh -lc "apk add --no-cache wget >/dev/null 2>&1 || true; wget -O $input '$getUrl' && ebook-convert $input $output"

# Ask API for presign put
$resp = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/v1/books/$BookId/presign_put_converted" -Headers $headers -ContentType "application/json"
$put = $resp.data.put_url
$key = $resp.data.key

# Copy file to host and upload via presign PUT
docker compose cp calibre:$output ./tmp-output-$id.epub
Invoke-WebRequest -Method Put -Uri $put -InFile (Resolve-Path ./tmp-output-$id.epub)
Remove-Item -Force ./tmp-output-$id.epub

# Update book record
Invoke-RestMethod -Method Post -Uri "$ApiBase/api/v1/books/$BookId/set_converted" -Headers $headers -ContentType "application/json" -Body (@{ key=$key } | ConvertTo-Json)

Write-Output "Converted and uploaded: $key"