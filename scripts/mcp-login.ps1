param(
  [string]$Issuer = 'http://localhost:8080/realms/ugo',
  [string]$ClientId = 'ugo-mcp'
)
$ErrorActionPreference = 'Stop'

# Prints a Keycloak offline refresh token for the stdio MCP server (device flow with PKCE).
function ConvertTo-Base64Url([byte[]]$Bytes) {
  [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$random = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($random)
$verifier = ConvertTo-Base64Url $random
$challenge = ConvertTo-Base64Url ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::ASCII.GetBytes($verifier)))

$device = Invoke-RestMethod -Method Post -Uri "$Issuer/protocol/openid-connect/auth/device" -Body @{
  client_id             = $ClientId
  scope                 = 'openid offline_access'
  code_challenge        = $challenge
  code_challenge_method = 'S256'
}

Write-Host "Log in at: $($device.verification_uri_complete)"
Start-Process $device.verification_uri_complete

$interval = [Math]::Max([int]$device.interval, 1)
$deadline = (Get-Date).AddSeconds([int]$device.expires_in)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds $interval
  try {
    $token = Invoke-RestMethod -Method Post -Uri "$Issuer/protocol/openid-connect/token" -Body @{
      grant_type    = 'urn:ietf:params:oauth:grant-type:device_code'
      client_id     = $ClientId
      device_code   = $device.device_code
      code_verifier = $verifier
    }
    Write-Host ''
    Write-Host 'Set this in the MCP server environment (keep it secret):'
    Write-Host "UGO_REFRESH_TOKEN=$($token.refresh_token)"
    return
  } catch {
    $error_ = $null
    try { $error_ = ($_.ErrorDetails.Message | ConvertFrom-Json).error } catch { }
    if ($error_ -eq 'authorization_pending') { continue }
    if ($error_ -eq 'slow_down') { $interval += 5; continue }
    throw
  }
}
throw 'Login timed out'
