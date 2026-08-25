$ErrorActionPreference = "Stop"
$headers = @{
  "apikey"        = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndhbmNlY2h4YXBlemxpd2l3bGtlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTY2OTY5MCwiZXhwIjoyMDkxMjQ1NjkwfQ.8kQv54DQOQscolOiS5NW_XYXzjPYjut3pCj5uLPbYWw"
  "Authorization" = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndhbmNlY2h4YXBlemxpd2l3bGtlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTY2OTY5MCwiZXhwIjoyMDkxMjQ1NjkwfQ.8kQv54DQOQscolOiS5NW_XYXzjPYjut3pCj5uLPbYWw"
}

Write-Host "===================================================="
Write-Host "STEP 1: atendimento_leads phone like 17744412148"
Write-Host "===================================================="
$url1 = "https://wancechxapezliwiwlke.supabase.co/rest/v1/atendimento_leads?or=(phone.ilike.*17744412148*,phone.ilike.*177*12148*)&select=id,full_name,phone,experimental_class_booking_id,experimental_class_status,experimental_class_professor_name,experimental_class_professor_phone,recurring_class_professor_name,recurring_class_professor_phone,status,funnel_stage,created_at,updated_at"
$r1 = Invoke-RestMethod -Uri $url1 -Headers $headers -Method Get -UseBasicParsing
$r1 | ConvertTo-Json -Depth 10

$leadId = if ($r1 -is [array]) { $r1[0].id } else { $r1.id }
Write-Host "=> LEAD_ID = $leadId"

if ([string]::IsNullOrWhiteSpace($leadId)) {
  Write-Host "Lead nao encontrado. Pesquisando por todos atendimento_experimental_class_bookings"
  $url0 = "https://wancechxapezliwiwlke.supabase.co/rest/v1/atendimento_experimental_class_bookings?order=created_at.desc&limit=20&select=id,lead_id,status,attendance_status,student_start_notification_sent_at,attendant_start_notification_sent_at,assigned_professor_name,assigned_professor_phone,professor_date,professor_time,lead_date,lead_time,created_at,updated_at"
  $r0 = Invoke-RestMethod -Uri $url0 -Headers $headers -Method Get -UseBasicParsing
  $r0 | ConvertTo-Json -Depth 10
  exit 0
}

Write-Host ""
Write-Host "===================================================="
Write-Host "STEP 2: experimental_class_bookings WHERE lead_id = $leadId"
Write-Host "===================================================="
$url2 = "https://wancechxapezliwiwlke.supabase.co/rest/v1/atendimento_experimental_class_bookings?lead_id=eq.$leadId&order=created_at.desc&select=id,lead_id,status,attendance_status,lesson_link,student_start_notification_sent_at,attendant_start_notification_sent_at,assigned_professor_name,assigned_professor_phone,professor_date,professor_time,lead_date,lead_time,professor_start_at,lead_start_at,created_at,updated_at"
$r2 = Invoke-RestMethod -Uri $url2 -Headers $headers -Method Get -UseBasicParsing
$r2 | ConvertTo-Json -Depth 10

Write-Host ""
Write-Host "===================================================="
Write-Host "STEP 3: atendimento_history_events ultimos 20 WHERE lead_id = $leadId, type=scheduled/cancelled/notification"
Write-Host "===================================================="
$url3 = "https://wancechxapezliwiwlke.supabase.co/rest/v1/atendimento_history_events?lead_id=eq.$leadId&order=created_at.desc&limit=20&select=id,event_type,created_at,details"
try {
  $r3 = Invoke-RestMethod -Uri $url3 -Headers $headers -Method Get -UseBasicParsing
  $r3 | ConvertTo-Json -Depth 10
} catch {
  Write-Host "History event select failed: $_"
}
