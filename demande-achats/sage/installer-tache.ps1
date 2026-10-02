# =====================================================================
#  Installe le connecteur comme tache planifiee Windows (toutes les 5 minutes)
#  A lancer UNE FOIS, en administrateur, depuis le dossier du connecteur :
#    powershell -ExecutionPolicy Bypass -File .\installer-tache.ps1
# =====================================================================
$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot
$script = Join-Path $dir "connecteur-sage.ps1"
if (-not (Test-Path (Join-Path $dir "connecteur-config.json"))) {
    Write-Host "Creez d'abord connecteur-config.json (copie de connecteur-config.exemple.json, completee)." -ForegroundColor Red
    Read-Host "Entree pour fermer"; exit 1
}
Write-Host "La tache s'executera avec ce compte Windows (il doit pouvoir lire les bases Sage dans SQL Server)."
$cred = Get-Credential -UserName ($env:USERDOMAIN + "\" + $env:USERNAME) -Message "Mot de passe du compte Windows qui executera le connecteur"
$action   = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"" + $script + "`"") -WorkingDirectory $dir
$trigger  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable
Register-ScheduledTask -TaskName "Connecteur DA Sage" -Action $action -Trigger $trigger -Settings $settings `
    -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Highest -Force | Out-Null
Write-Host "Tache 'Connecteur DA Sage' installee : execution toutes les 5 minutes." -ForegroundColor Green
Write-Host "Journal : $dir\connecteur.log"
Read-Host "Entree pour fermer"
