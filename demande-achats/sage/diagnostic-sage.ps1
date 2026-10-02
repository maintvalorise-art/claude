# =====================================================================
#  Diagnostic Sage 100 - Demandes d'achat (LECTURE SEULE)
#  Ce script NE MODIFIE RIEN : il lit seulement des informations pour
#  preparer le connecteur Application <-> Sage 100 Gestion Commerciale.
#
#  Lancement (sur le PC ou se trouve SQL Server / Sage) :
#    1. Copier ce fichier sur le Bureau
#    2. Menu Demarrer > taper "PowerShell" > clic droit > "Executer en tant qu'administrateur"
#    3. Taper :  cd $env:USERPROFILE\Desktop
#    4. Taper :  powershell -ExecutionPolicy Bypass -File .\diagnostic-sage.ps1
#  Le resultat est enregistre sur le Bureau : diagnostic-sage.txt
#  (il ne contient aucun mot de passe). Envoyez ce fichier.
# =====================================================================

$ErrorActionPreference = "Continue"
$out = Join-Path ([Environment]::GetFolderPath("Desktop")) "diagnostic-sage.txt"
$lines = New-Object System.Collections.Generic.List[string]
function Log([string]$t) { Write-Host $t; $lines.Add($t) }

Log "=== Diagnostic Sage 100 - $(Get-Date -Format 'yyyy-MM-dd HH:mm') ==="
Log ("Ordinateur : " + $env:COMPUTERNAME + " | Windows : " + [Environment]::OSVersion.VersionString)
Log ("PowerShell : " + $PSVersionTable.PSVersion.ToString() + " | 64 bits : " + [Environment]::Is64BitProcess)
Log ""

# --- 1. Instances SQL Server installees sur ce PC -----------------------
Log "--- 1. Services SQL Server ---"
$instances = @()
$services = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq "MSSQLSERVER" -or $_.Name -like 'MSSQL$*' }
foreach ($s in $services) {
    Log ("Service " + $s.Name + " : " + $s.Status)
    if ($s.Name -eq "MSSQLSERVER") { $instances += "localhost" }
    else { $instances += ("localhost\" + $s.Name.Substring(6)) }
}
if ($instances.Count -eq 0) {
    Log "Aucun service SQL Server trouve sur ce PC (la base est peut-etre sur un autre serveur)."
    $srv = Read-Host "Nom du serveur SQL (ex : SERVEUR\SAGE100) ou Entree pour passer"
    if ($srv) { $instances += $srv }
}
Log ""

# --- 2. Connexion SQL et recherche des dossiers Sage ----------------------
function Open-Sql([string]$server, [string]$db, $cred) {
    $cs = "Server=$server;Database=$db;Connect Timeout=8;"
    if ($cred) { $cs += "User ID=" + $cred.UserName + ";Password=" + $cred.GetNetworkCredential().Password + ";" }
    else { $cs += "Integrated Security=True;" }
    $c = New-Object System.Data.SqlClient.SqlConnection $cs
    $c.Open()
    return $c
}
function Query($conn, [string]$sql) {
    $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 30
    $t = New-Object System.Data.DataTable
    $t.Load($cmd.ExecuteReader())
    return ,$t
}

Log "--- 2. Dossiers Sage 100 trouves ---"
$cred = $null
foreach ($inst in $instances) {
    $conn = $null
    try { $conn = Open-Sql $inst "master" $null; Log ("Connexion a " + $inst + " : OK (authentification Windows)") }
    catch {
        Log ("Connexion Windows a " + $inst + " impossible : " + $_.Exception.Message)
        $rep = Read-Host "Avez-vous un identifiant SQL (ex : sa) pour $inst ? (o/n)"
        if ($rep -eq "o") {
            $cred = Get-Credential -Message "Identifiant SQL Server pour $inst (non enregistre)"
            try { $conn = Open-Sql $inst "master" $cred; Log ("Connexion a " + $inst + " : OK (identifiant SQL)") }
            catch { Log ("Echec : " + $_.Exception.Message) }
        }
    }
    if (-not $conn) { continue }
    $dbs = Query $conn "SELECT name FROM sys.databases WHERE database_id > 4 AND state = 0 ORDER BY name"
    $conn.Close()
    foreach ($row in $dbs.Rows) {
        $db = $row.name
        try {
            $c = Open-Sql $inst $db $cred
            $isSage = Query $c "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME IN ('F_DOCENTETE','F_DOCLIGNE','F_ARTICLE','F_COMPTET')"
            if ($isSage.Rows[0].n -lt 4) { $c.Close(); continue }
            Log ""
            Log ("### Dossier Sage : " + $inst + " / base " + $db)
            $q = @(
                @("Articles (total / actifs)",            "SELECT COUNT(*) AS total, SUM(CASE WHEN AR_Sommeil = 0 THEN 1 ELSE 0 END) AS actifs FROM F_ARTICLE"),
                @("Fournisseurs (total / actifs)",        "SELECT COUNT(*) AS total, SUM(CASE WHEN CT_Sommeil = 0 THEN 1 ELSE 0 END) AS actifs FROM F_COMPTET WHERE CT_Type = 1"),
                @("Depots",                               "SELECT DE_No, DE_Intitule FROM F_DEPOT"),
                @("Documents d'achat par type (DO_Type)", "SELECT DO_Type, COUNT(*) AS nb, MAX(DO_Piece) AS derniere_piece, MAX(DO_Date) AS derniere_date FROM F_DOCENTETE WHERE DO_Domaine = 1 GROUP BY DO_Type ORDER BY DO_Type"),
                @("Exemple d'articles (5)",               "SELECT TOP 5 AR_Ref, AR_Design, AR_UniteVen, AR_PrixAch FROM F_ARTICLE WHERE AR_Sommeil = 0 ORDER BY AR_Ref"),
                @("Exemple de fournisseurs (5)",          "SELECT TOP 5 CT_Num, CT_Intitule FROM F_COMPTET WHERE CT_Type = 1 AND CT_Sommeil = 0 ORDER BY CT_Num"),
                @("Souches / numerotation achats",        "SELECT TOP 20 * FROM F_DOCCURRENTPIECE WHERE DC_Domaine = 1")
            )
            foreach ($item in $q) {
                try {
                    $t = Query $c $item[1]
                    Log ("- " + $item[0] + " :")
                    foreach ($r in $t.Rows) {
                        $vals = @(); foreach ($col in $t.Columns) { $vals += ($col.ColumnName + "=" + $r[$col.ColumnName]) }
                        Log ("    " + ($vals -join " | "))
                    }
                } catch { Log ("- " + $item[0] + " : non disponible (" + $_.Exception.Message + ")") }
            }
            $c.Close()
        } catch { }
    }
}
Log ""

# --- 3. Sage 100 et Objets Metiers installes ------------------------------
Log "--- 3. Logiciels Sage installes ---"
$keys = @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*")
Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*Sage*" -or $_.DisplayName -like "*Objets*" } |
    Sort-Object DisplayName | ForEach-Object { Log ("  " + $_.DisplayName + "  v" + $_.DisplayVersion) }

Log ""
Log "--- 4. Objets Metiers (COM) ---"
$progIds = @()
try {
    $progIds = Get-ChildItem "Registry::HKEY_CLASSES_ROOT" -ErrorAction SilentlyContinue |
        Where-Object { $_.PSChildName -like "Objets100*" } | ForEach-Object { $_.PSChildName }
} catch { }
if ($progIds.Count -gt 0) { foreach ($p in $progIds) { Log ("  Trouve : " + $p) } }
else { Log "  Aucun composant Objets Metiers (Objets100...) enregistre sur ce PC." }

Log ""
Log "--- 5. Fichiers de dossier Sage (.gcm / .mae) ---"
$roots = @("C:\ProgramData\Sage", "C:\Users\Public\Documents\Sage", "C:\Sage", "D:\Sage")
foreach ($root in $roots) {
    if (Test-Path $root) {
        Get-ChildItem $root -Recurse -Include *.gcm, *.mae -ErrorAction SilentlyContinue | Select-Object -First 10 |
            ForEach-Object { Log ("  " + $_.FullName) }
    }
}

Log ""
Log "--- 6. Acces Internet (pour joindre Supabase) ---"
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $r = Invoke-WebRequest -Uri "https://supabase.com" -UseBasicParsing -TimeoutSec 10
    Log ("  supabase.com joignable (HTTP " + $r.StatusCode + ")")
} catch { Log ("  supabase.com NON joignable : " + $_.Exception.Message) }

$lines | Out-File -FilePath $out -Encoding UTF8
Write-Host ""
Write-Host "Termine. Resultat enregistre dans : $out" -ForegroundColor Green
Write-Host "Envoyez ce fichier (il ne contient aucun mot de passe)." -ForegroundColor Green
Read-Host "Appuyez sur Entree pour fermer"
