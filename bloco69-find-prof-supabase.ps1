$ErrorActionPreference = "Stop"
$headers = @{
  "apikey"        = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndhbmNlY2h4YXBlemxpd2l3bGtlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTY2OTY5MCwiZXhwIjoyMDkxMjQ1NjkwfQ.8kQv54DQOQscolOiS5NW_XYXzjPYjut3pCj5uLPbYWw"
  "Authorization" = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndhbmNlY2h4YXBlemxpd2l3bGtlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTY2OTY5MCwiZXhwIjoyMDkxMjQ1NjkwfQ.8kQv54DQOQscolOiS5NW_XYXzjPYjut3pCj5uLPbYWw"
  "Prefer"        = "return=representation"
}

Write-Host "===================================================="
Write-Host "STEP 1: Busca bookings por IDs dos history events do Alarico"
Write-Host "===================================================="
$ids = @(
  "11540ab7-d42d-485a-8b17-536b7ef92e2b",
  "5aaef54a-bf8e-4aac-a100-168f98ed33a3"
)
foreach ($bid in $ids) {
  $url = "https://wancechxapezliwiwlke.supabase.co/rest/v1/atendimento_experimental_class_bookings?id=eq.$bid&select=id,lead_id,status,attendance_status,assigned_professor_name,assigned_professor_phone,student_start_notification_sent_at,attendant_start_notification_sent_at,created_at,updated_at"
  try {
    $r = Invoke-RestMethod -Uri $url -Headers $headers -Method Get -UseBasicParsing
    Write-Host "[$bid] =>"
    $r | ConvertTo-Json -Depth 10
  } catch {
    Write-Host "[$bid] error: $($_.Exception.Message)"
  }
}

Write-Host ""
Write-Host "===================================================="
Write-Host "STEP 2: ALL atendimento_history_events do lead, ANY com professor nos details"
Write-Host "===================================================="
$leadId = "fa87409c-ad12-4ff8-918b-fd6c384bcce6"
$url2 = "https://wancechxapezliwiwlke.supabase.co/rest/v1/atendimento_history_events?lead_id=eq.$leadId&order=created_at.desc&select=id,event_type,created_at,details"
$r2 = Invoke-RestMethod -Uri $url2 -Headers $headers -Method Get -UseBasicParsing
foreach ($ev in $r2) {
  $d = $ev.details | ConvertTo-Json -Depth 5 -Compress
  Write-Host "  [$($ev.event_type)] created=$($ev.created_at) => $d"
}

Write-Host ""
Write-Host "===================================================="
Write-Host "STEP 3: LEAD columns related (confirm null)"
Write-Host "===================================================="
$url3 = "https://wancechxapezliwiwlke.supabase.co/rest/v1/atendimento_leads?id=eq.$leadId&select=id,experimental_class_professor_name,experimental_class_professor_phone,recurring_class_professor_name,recurring_class_professor_phone,experimental_class_booking_id,experimental_class_status,status"
$r3 = Invoke-RestMethod -Uri $url3 -Headers $headers -Method Get -UseBasicParsing
$r3 | ConvertTo-Json -Depth 10
