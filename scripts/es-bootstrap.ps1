param(
  [string]$BaseUrl = "http://localhost:9200",
  [string]$NotesIndex = "notes",
  [string]$HighlightsIndex = "highlights",
  [string]$BooksIndex = "books"
)
$ErrorActionPreference = "Stop"
Invoke-RestMethod -Method Put -Uri "$BaseUrl/$NotesIndex" -ContentType 'application/json' -Body (@{
  settings = @{ number_of_shards = 1; number_of_replicas = 0 }
  mappings = @{ properties = @{ id=@{type='keyword'}; user_id=@{type='keyword'}; book_id=@{type='keyword'}; content=@{type='text'}; tag_ids=@{type='keyword'} } }
} | ConvertTo-Json -Depth 6) | Out-Null
Invoke-RestMethod -Method Put -Uri "$BaseUrl/$HighlightsIndex" -ContentType 'application/json' -Body (@{
  settings = @{ number_of_shards = 1; number_of_replicas = 0 }
  mappings = @{ properties = @{ id=@{type='keyword'}; user_id=@{type='keyword'}; book_id=@{type='keyword'}; text_content=@{type='text'}; color=@{type='keyword'}; tag_ids=@{type='keyword'} } }
} | ConvertTo-Json -Depth 6) | Out-Null
Invoke-RestMethod -Method Put -Uri "$BaseUrl/$BooksIndex" -ContentType 'application/json' -Body (@{
  settings = @{ number_of_shards = 1; number_of_replicas = 0 }
  mappings = @{ properties = @{ id=@{type='keyword'}; user_id=@{type='keyword'}; title=@{type='text'}; author=@{type='text'} } }
} | ConvertTo-Json -Depth 6) | Out-Null
Write-Output "ES indices ensured: $NotesIndex, $HighlightsIndex, $BooksIndex"