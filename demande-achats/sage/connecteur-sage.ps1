# =====================================================================
#  Connecteur Demandes d'achat (Supabase)  <->  Sage 100 Gestion commerciale
#
#  A chaque execution (planifiee toutes les 5 minutes) :
#   1. Catalogue  : envoie les articles et fournisseurs actifs de chaque
#                   dossier Sage vers l'application (lecture seule dans Sage).
#   2. Export     : pour chaque DA que l'admin a transmise ("a exporter"),
#                   genere un fichier d'import Sage (Demande d'achat, type 10).
#   3. Controle   : retrouve dans Sage les DA importees (DO_Ref = no de la DA
#                   dans l'application) et renvoie le no de piece Sage.
#
#  Le connecteur N'ECRIT JAMAIS dans la base Sage : il lit seulement.
#  La creation dans Sage se fait par l'import standard de Sage (fichier).
#
#  Parametres : connecteur-config.json (a cote de ce script).
#  Test manuel : powershell -ExecutionPolicy Bypass -File .\connecteur-sage.ps1
# =====================================================================
param(
    [string]$Config = (Join-Path $PSScriptRoot "connecteur-config.json"),
    [string]$Simulation = ""        # fichier JSON de donnees Sage simulees (tests sans SQL Server)
)

$ErrorActionPreference = "Stop"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

# ---------------------------------------------------------------- Journal
$LogFile = Join-Path $PSScriptRoot "connecteur.log"
function Log([string]$msg, [string]$niveau = "INFO") {
    $line = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " [" + $niveau + "] " + $msg
    Write-Host $line
    try {
        if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 2MB)) { Move-Item $LogFile ($LogFile + ".old") -Force }
        Add-Content -Path $LogFile -Value $line -Encoding UTF8
    } catch { }
}

# ---------------------------------------------------------------- Configuration
if (-not (Test-Path $Config)) { Log ("Fichier de configuration introuvable : " + $Config) "ERREUR"; exit 1 }
$cfg = Get-Content $Config -Raw -Encoding UTF8 | ConvertFrom-Json
$SupaUrl = ([string]$cfg.SupabaseUrl).Trim().TrimEnd("/") -replace "/(rest|auth)/v1/?$", ""
$SupaKey = ([string]$cfg.ServiceRoleKey).Trim()
if (-not $SupaUrl -or -not $SupaKey -or $SupaKey -like "COLLEZ*") { Log "SupabaseUrl / ServiceRoleKey non renseignes dans la configuration." "ERREUR"; exit 1 }
$Fmt = $cfg.Fichier
$StateFile = Join-Path $PSScriptRoot "connecteur-etat.json"

# ---------------------------------------------------------------- Supabase (API REST)
function Supa([string]$method, [string]$path, $body = $null, [string]$prefer = "") {
    $headers = @{ "apikey" = $SupaKey }
    if (-not $SupaKey.StartsWith("sb_")) { $headers["Authorization"] = "Bearer " + $SupaKey }
    if ($prefer) { $headers["Prefer"] = $prefer }
    $params = @{ Method = $method; Uri = ($SupaUrl + "/rest/v1/" + $path); Headers = $headers; TimeoutSec = 60 }
    if ($null -ne $body) {
        $json = ConvertTo-Json -InputObject $body -Depth 8 -Compress
        $params["Body"] = [Text.Encoding]::UTF8.GetBytes($json)
        $params["ContentType"] = "application/json; charset=utf-8"
    }
    try { return Invoke-RestMethod @params }
    catch {
        $detail = $_.Exception.Message
        try { $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream()); $detail += " " + $sr.ReadToEnd() } catch { }
        throw ("Supabase " + $method + " " + $path.Split("?")[0] + " : " + $detail)
    }
}
# Lignes renvoyees par un GET (filtre les resultats vides / nuls)
function Lignes($x) { return ,@(@($x) | Where-Object { $null -ne $_ -and $_.id }) }
function Patch-Demande([string]$id, $champs) {
    $champs["sage_le"] = (Get-Date).ToUniversalTime().ToString("o")
    Supa "PATCH" ("demandes?id=eq." + $id) $champs "return=minimal" | Out-Null
}

# ---------------------------------------------------------------- Sage (SQL Server, lecture seule)
$SimData = $null
if ($Simulation) { $SimData = Get-Content $Simulation -Raw -Encoding UTF8 | ConvertFrom-Json; Log ("MODE SIMULATION : " + $Simulation) }

function Sql-Query([string]$base, [string]$sql, [hashtable]$p = @{}) {
    $cs = "Server=" + $cfg.SqlInstance + ";Database=" + $base + ";Connect Timeout=15;Application Name=Connecteur DA;"
    if ($cfg.SqlUtilisateur) { $cs += "User ID=" + $cfg.SqlUtilisateur + ";Password=" + $cfg.SqlMotDePasse + ";" }
    else { $cs += "Integrated Security=True;" }
    $conn = New-Object System.Data.SqlClient.SqlConnection $cs
    try {
        $conn.Open()
        $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 60
        foreach ($k in $p.Keys) { [void]$cmd.Parameters.AddWithValue($k, $p[$k]) }
        $t = New-Object System.Data.DataTable
        $t.Load($cmd.ExecuteReader())
        return ,$t
    } finally { $conn.Close() }
}

function Sage-Articles([string]$base) {
    if ($SimData) { return @($SimData.$base.articles) }
    $t = Sql-Query $base "SELECT AR_Ref, AR_Design, AR_PrixAch FROM F_ARTICLE WHERE AR_Sommeil = 0"
    $out = @(); foreach ($r in $t.Rows) { $out += [pscustomobject]@{ AR_Ref = [string]$r.AR_Ref; AR_Design = [string]$r.AR_Design; AR_PrixAch = [double]$r.AR_PrixAch } }
    return $out
}
function Sage-Fournisseurs([string]$base) {
    if ($SimData) { return @($SimData.$base.fournisseurs) }
    $t = Sql-Query $base "SELECT CT_Num, CT_Intitule FROM F_COMPTET WHERE CT_Type = 1 AND CT_Sommeil = 0"
    $out = @(); foreach ($r in $t.Rows) { $out += [pscustomobject]@{ CT_Num = [string]$r.CT_Num; CT_Intitule = [string]$r.CT_Intitule } }
    return $out
}
# Retourne le no de piece Sage de la Demande d'achat (type 10) dont la reference = no de la DA, sinon $null
function Sage-PieceParReference([string]$base, [string]$ref) {
    if ($SimData) {
        $d = @($SimData.$base.documents) | Where-Object { $_.DO_Ref -eq $ref } | Select-Object -First 1
        if ($d) { return [string]$d.DO_Piece } else { return $null }
    }
    $t = Sql-Query $base "SELECT TOP 1 DO_Piece FROM F_DOCENTETE WHERE DO_Domaine = 1 AND DO_Type = 10 AND DO_Ref = @ref ORDER BY cbMarq DESC" @{ "@ref" = $ref }
    if ($t.Rows.Count -gt 0) { return [string]$t.Rows[0].DO_Piece } else { return $null }
}

function Base-DeSociete([string]$code) {
    foreach ($s in $cfg.Societes) { if ($s.Code -eq $code) { return [string]$s.Base } }
    return $null
}

# ---------------------------------------------------------------- 1. Catalogue
function Sync-Catalogue {
    $debut = (Get-Date).ToUniversalTime().ToString("o")
    foreach ($s in $cfg.Societes) {
        $code = [string]$s.Code; $base = [string]$s.Base
        $arts = Sage-Articles $base
        $rows = @(); foreach ($a in $arts) { if ($a.AR_Ref) { $rows += @{ societe = $code; ar_ref = $a.AR_Ref.Trim().ToUpper(); ar_design = $a.AR_Design; prix_achat = [double]$a.AR_PrixAch; synced_at = $debut } } }
        for ($i = 0; $i -lt $rows.Count; $i += 500) {
            $lot = $rows[$i..([Math]::Min($i + 499, $rows.Count - 1))]
            Supa "POST" "sage_articles?on_conflict=societe,ar_ref" @($lot) "resolution=merge-duplicates,return=minimal" | Out-Null
        }
        Supa "DELETE" ("sage_articles?societe=eq." + [Uri]::EscapeDataString($code) + "&synced_at=lt." + [Uri]::EscapeDataString($debut)) $null "return=minimal" | Out-Null

        $fours = Sage-Fournisseurs $base
        $rows = @(); foreach ($f in $fours) { if ($f.CT_Num) { $rows += @{ societe = $code; ct_num = $f.CT_Num.Trim().ToUpper(); ct_intitule = $f.CT_Intitule; synced_at = $debut } } }
        for ($i = 0; $i -lt $rows.Count; $i += 500) {
            $lot = $rows[$i..([Math]::Min($i + 499, $rows.Count - 1))]
            Supa "POST" "sage_fournisseurs?on_conflict=societe,ct_num" @($lot) "resolution=merge-duplicates,return=minimal" | Out-Null
        }
        Supa "DELETE" ("sage_fournisseurs?societe=eq." + [Uri]::EscapeDataString($code) + "&synced_at=lt." + [Uri]::EscapeDataString($debut)) $null "return=minimal" | Out-Null
        Log ("Catalogue " + $code + " : " + @($arts).Count + " articles, " + @($fours).Count + " fournisseurs envoyes")
    }
}

# ---------------------------------------------------------------- 2. Export des DA vers un fichier d'import Sage
function Nettoyer([string]$v, [int]$max) {
    $v = ([string]$v) -replace "[\r\n\t]", " "
    $v = $v.Replace([string]$Fmt.Separateur, " ").Trim()
    if ($max -gt 0 -and $v.Length -gt $max) { $v = $v.Substring(0, $max) }
    return $v
}
function Nombre($n) {
    $s = ([double]$n).ToString("0.######", [Globalization.CultureInfo]::InvariantCulture)
    if ($Fmt.SeparateurDecimal -eq ",") { $s = $s.Replace(".", ",") }
    return $s
}
function Remplir([object[]]$colonnes, [hashtable]$valeurs) {
    $out = @()
    foreach ($c in $colonnes) {
        $v = [string]$c
        foreach ($k in $valeurs.Keys) { $v = $v.Replace("{" + $k + "}", [string]$valeurs[$k]) }
        $out += $v
    }
    return ($out -join [string]$Fmt.Separateur)
}

function Export-Demandes {
    $das = Lignes (Supa "GET" "demandes?sage_statut=eq.a_exporter&select=id,numero,societe,sage_fournisseur,lignes,date_souhaitee,demandeur_nom,service,motif&order=numero")
    if ($das.Count -eq 0) { return }
    $parSociete = @{}
    foreach ($da in $das) {
        $base = Base-DeSociete $da.societe
        if (-not $base) { Patch-Demande $da.id @{ sage_statut = "erreur"; sage_message = ("Societe inconnue du connecteur : " + $da.societe) }; continue }
        try {
            # Securite anti-doublon : deja present dans Sage ?
            $piece = Sage-PieceParReference $base $da.numero
            if ($piece) { Patch-Demande $da.id @{ sage_statut = "importe"; sage_piece = $piece; sage_message = $null }; Log ($da.numero + " deja presente dans Sage (" + $piece + ")"); continue }
            $date = Get-Date -Format $Fmt.FormatDate
            $livr = ""; if ($da.date_souhaitee) { $livr = ([datetime]$da.date_souhaitee).ToString($Fmt.FormatDate) }
            $enTete = @{
                TYPE = "10"; PIECE = ""; DATE = $date; DATE_LIVRAISON = $livr; REFERENCE = (Nettoyer $da.numero 17);
                FOURNISSEUR = (Nettoyer $da.sage_fournisseur 17); DEPOT = [string]$cfg.Depot; SOCIETE = $da.societe;
                DEMANDEUR = (Nettoyer $da.demandeur_nom 35); SERVICE = (Nettoyer $da.service 35); MOTIF = (Nettoyer $da.motif 69)
            }
            $txt = @(Remplir $Fmt.Entete $enTete)
            foreach ($l in @($da.lignes)) {
                if (-not $l.ar_ref) { throw ("Ligne sans article Sage : " + $l.designation) }
                $prix = 0; if ($l.prix_unitaire) { $prix = $l.prix_unitaire }
                $txt += Remplir $Fmt.Ligne @{
                    ARTICLE = (Nettoyer $l.ar_ref 19); DESIGNATION = (Nettoyer $l.designation 69); QUANTITE = (Nombre $l.quantite);
                    PRIX = (Nombre $prix); REF_CONSTRUCTEUR = (Nettoyer $l.reference 19); REFERENCE = (Nettoyer $da.numero 17); UNITE = (Nettoyer $l.unite 10)
                }
            }
            if (-not $parSociete.ContainsKey($da.societe)) { $parSociete[$da.societe] = New-Object System.Collections.ArrayList }
            [void]$parSociete[$da.societe].Add([pscustomobject]@{ Da = $da; Lignes = $txt })
        } catch {
            Patch-Demande $da.id @{ sage_statut = "erreur"; sage_message = ("Export : " + $_.Exception.Message) }
            Log ($da.numero + " : " + $_.Exception.Message) "ERREUR"
        }
    }
    foreach ($soc in $parSociete.Keys) {
        $dossier = Join-Path $cfg.DossierImport $soc
        if (-not (Test-Path $dossier)) { New-Item -ItemType Directory -Path $dossier -Force | Out-Null }
        $fichier = Join-Path $dossier ("DA_APP_" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".txt")
        $toutes = @(); foreach ($e in $parSociete[$soc]) { $toutes += $e.Lignes }
        $enc = [Text.Encoding]::GetEncoding([string]$Fmt.Encodage)
        [IO.File]::WriteAllLines($fichier, [string[]]$toutes, $enc)
        foreach ($e in $parSociete[$soc]) {
            Patch-Demande $e.Da.id @{ sage_statut = "fichier_pret"; sage_fichier = $fichier; sage_message = $null }
        }
        Log ("Fichier d'import " + $soc + " : " + $fichier + " (" + $parSociete[$soc].Count + " DA)")
    }
}

# ---------------------------------------------------------------- 3. Controle des imports dans Sage
function Controle-Imports {
    $das = Lignes (Supa "GET" "demandes?sage_statut=eq.fichier_pret&select=id,numero,societe,sage_fichier")
    foreach ($da in $das) {
        $base = Base-DeSociete $da.societe
        if (-not $base) { continue }
        $piece = Sage-PieceParReference $base $da.numero
        if ($piece) {
            Patch-Demande $da.id @{ sage_statut = "importe"; sage_piece = $piece; sage_message = $null }
            Log ($da.numero + " importee dans Sage : piece " + $piece)
            # Archiver le fichier quand toutes ses DA sont importees
            if ($da.sage_fichier -and (Test-Path $da.sage_fichier)) {
                $restantes = Lignes (Supa "GET" ("demandes?sage_statut=eq.fichier_pret&sage_fichier=eq." + [Uri]::EscapeDataString($da.sage_fichier) + "&select=id"))
                if ($restantes.Count -eq 0) {
                    $arch = Join-Path (Split-Path $da.sage_fichier) "importes"
                    if (-not (Test-Path $arch)) { New-Item -ItemType Directory -Path $arch -Force | Out-Null }
                    Move-Item $da.sage_fichier $arch -Force
                }
            }
        }
    }
}

# ---------------------------------------------------------------- Execution
$etat = @{ derniere_synchro = "2000-01-01T00:00:00Z" }
if (Test-Path $StateFile) { try { $j = Get-Content $StateFile -Raw | ConvertFrom-Json; $etat.derniere_synchro = [string]$j.derniere_synchro } catch { } }
$code = 0
try {
    $minutes = 60; if ($cfg.CatalogueToutesLesMinutes) { $minutes = [int]$cfg.CatalogueToutesLesMinutes }
    if (((Get-Date).ToUniversalTime() - ([datetime]$etat.derniere_synchro).ToUniversalTime()).TotalMinutes -ge $minutes) {
        Sync-Catalogue
        $etat.derniere_synchro = (Get-Date).ToUniversalTime().ToString("o")
        ConvertTo-Json $etat | Set-Content $StateFile -Encoding UTF8
    }
} catch { Log ("Catalogue : " + $_.Exception.Message) "ERREUR"; $code = 2 }
try { Export-Demandes } catch { Log ("Export : " + $_.Exception.Message) "ERREUR"; $code = 2 }
try { Controle-Imports } catch { Log ("Controle : " + $_.Exception.Message) "ERREUR"; $code = 2 }
exit $code
