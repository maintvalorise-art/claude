# =====================================================================
#  Test d'acces Internet du serveur Sage (LECTURE SEULE - ne modifie rien)
#  Lancement (PowerShell en administrateur, depuis le Bureau) :
#    cd $env:USERPROFILE\Desktop
#    powershell -ExecutionPolicy Bypass -File .\test-internet.ps1
#  Resultat : test-internet.txt sur le Bureau -> a envoyer.
# =====================================================================
$out = Join-Path ([Environment]::GetFolderPath("Desktop")) "test-internet.txt"
$lines = New-Object System.Collections.Generic.List[string]
function Log([string]$t) { Write-Host $t; $lines.Add($t) }
function Run([string]$titre, [scriptblock]$code) {
    Log ""; Log ("--- " + $titre + " ---")
    try { $r = & $code 2>&1 | Out-String; foreach ($l in ($r -split "`r?`n")) { if ($l.Trim()) { Log ("  " + $l.TrimEnd()) } } }
    catch { Log ("  ERREUR : " + $_.Exception.Message) }
}
$cible = "lcdetsremuoyyxmstdju.supabase.co"
Log ("=== Test Internet - " + $env:COMPUTERNAME + " - " + (Get-Date -Format "yyyy-MM-dd HH:mm") + " ===")

Run "1. Role du serveur (domaine / controleur de domaine / DNS)" {
    $cs = Get-WmiObject Win32_ComputerSystem
    "Domaine : " + $cs.Domain + " | Membre d'un domaine : " + $cs.PartOfDomain + " | DomainRole : " + $cs.DomainRole + " (4/5 = controleur de domaine)"
    try { Get-WindowsFeature DNS, AD-Domain-Services | Select-Object Name, InstallState | Format-Table -AutoSize } catch { "Get-WindowsFeature indisponible" }
}
Run "2. Cartes reseau et serveurs DNS" {
    Get-WmiObject Win32_NetworkAdapterConfiguration -Filter "IPEnabled = True" | ForEach-Object {
        "Carte : " + $_.Description
        "  IP : " + ($_.IPAddress -join ", ") + " | Passerelle : " + ($_.DefaultIPGateway -join ", ")
        "  DNS : " + ($_.DNSServerSearchOrder -join ", ")
    }
}
Run "3. Acces Internet par adresse IP (sans DNS)" {
    "Ping 8.8.8.8 : " + (Test-Connection 8.8.8.8 -Count 2 -Quiet)
    "Ping 1.1.1.1 : " + (Test-Connection 1.1.1.1 -Count 2 -Quiet)
    $t = Test-NetConnection 1.1.1.1 -Port 443 -WarningAction SilentlyContinue
    "Port 443 vers 1.1.1.1 : " + $t.TcpTestSucceeded
}
Run "4. Resolution DNS avec le DNS actuel du serveur" { nslookup $cible }
Run "5. Resolution DNS avec le DNS public de Google (8.8.8.8)" { nslookup $cible 8.8.8.8 }
Run "6. Connexion HTTPS vers Supabase" {
    $t = Test-NetConnection $cible -Port 443 -WarningAction SilentlyContinue
    "Adresse resolue : " + $t.RemoteAddress + " | Port 443 ouvert : " + $t.TcpTestSucceeded
}
Run "7. Proxy configure" {
    netsh winhttp show proxy
    $ie = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -ErrorAction SilentlyContinue
    "Proxy utilisateur actif : " + $ie.ProxyEnable + " | Serveur : " + $ie.ProxyServer
}
Run "8. Redirecteurs du serveur DNS (si le role DNS est installe)" {
    try { Get-DnsServerForwarder | Format-List } catch { "Pas de role DNS sur ce serveur (normal)." }
}
$lines | Out-File -FilePath $out -Encoding UTF8
Write-Host ""; Write-Host "Termine. Envoyez le fichier : $out" -ForegroundColor Green
Read-Host "Appuyez sur Entree pour fermer"
