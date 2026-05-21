param([string]$Target, [string]$B64)
$bytes = [Convert]::FromBase64String($B64)
[System.IO.File]::AppendAllText((Resolve-Path -LiteralPath (Split-Path $Target -Parent)).Path + "\" + (Split-Path $Target -Leaf), [System.Text.Encoding]::UTF8.GetString($bytes))
