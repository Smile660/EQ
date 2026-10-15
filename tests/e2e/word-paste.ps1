# EqLens MathML -> Word paste E2E test (ASCII only: PS5.1 reads no-BOM files as ANSI)
# Usage: powershell -STA -NoProfile -File word-paste.ps1 -MmlFile <file> [-OutDocx <docx>] [-TimeoutSec 40]
# OK OMaths=N MathTypeOLE=M  = paste produced equations
# TIMEOUT                     = blocked by a modal dialog (MathType error dialog signature)
# ERR ...                     = Word COM error
param(
  [Parameter(Mandatory = $true)][string]$MmlFile,
  [string]$OutDocx = "",
  [int]$TimeoutSec = 40
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

function Make-CfHtml([string]$fragment) {
  $header = "Version:0.9`r`nStartHTML:{0:D10}`r`nEndHTML:{1:D10}`r`nStartFragment:{2:D10}`r`nEndFragment:{3:D10}`r`n"
  $pre = "<html><body>`r`n<!--StartFragment-->"
  $post = "<!--EndFragment-->`r`n</body></html>"
  $dummy = $header -f 0, 0, 0, 0
  $lenH = [Text.Encoding]::UTF8.GetByteCount($dummy)
  $lenPre = $lenH + [Text.Encoding]::UTF8.GetByteCount($pre)
  $lenFrag = [Text.Encoding]::UTF8.GetByteCount($fragment)
  $lenPost = [Text.Encoding]::UTF8.GetByteCount($post)
  $realHeader = $header -f 0, ($lenH + $lenPre + $lenFrag + $lenPost), $lenPre, ($lenPre + $lenFrag)
  return $realHeader + $pre + $fragment + $post
}

$Mml = [IO.File]::ReadAllText($MmlFile)
if (-not $OutDocx) { $OutDocx = Join-Path $env:TEMP ("eqtest_" + [IO.Path]::GetFileNameWithoutExtension($MmlFile) + ".docx") }
if (Test-Path $OutDocx) { Remove-Item $OutDocx -Force }

$cf = Make-CfHtml $Mml
$do = New-Object Windows.Forms.DataObject
$do.SetText($cf, [Windows.Forms.TextDataFormat]::Html)
$do.SetText($Mml, [Windows.Forms.TextDataFormat]::UnicodeText)
[Windows.Forms.Clipboard]::SetDataObject($do, $true)

$job = Start-Job -ScriptBlock {
  param($out)
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  try {
    $doc = $word.Documents.Add()
    $doc.ActiveWindow.Selection.Paste() | Out-Null
    $om = $doc.OMaths.Count
    $mt = @($doc.InlineShapes | Where-Object { $_.OLEFormat.ProgId -match 'Equation|MathType' }).Count
    $txt = $doc.Content.Text.Trim()
    $doc.SaveAs2($out)
    $doc.Close(0)
    $t = if ($txt.Length -gt 70) { $txt.Substring(0, 70) } else { $txt }
    "OK OMaths=$om MathTypeOLE=$mt Text=[$t]"
  } catch {
    "ERR " + $_.Exception.Message
  } finally {
    try { $word.Quit() } catch {}
  }
} -ArgumentList $OutDocx

if (Wait-Job $job -Timeout $TimeoutSec) {
  Receive-Job $job
} else {
  Stop-Job $job
  "TIMEOUT paste blocked by modal dialog (MathType error dialog signature)"
  Get-Process WINWORD -ErrorAction SilentlyContinue | Stop-Process -Force
}
Remove-Job $job -Force
