# Paste MathML into REAL Word, save as PDF for visual inspection
param(
  [Parameter(Mandatory = $true)][string]$MmlFile,
  [Parameter(Mandatory = $true)][string]$OutPdf,
  [int]$TimeoutSec = 40
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$Mml = [IO.File]::ReadAllText($MmlFile)
$header = "Version:0.9`r`nStartHTML:{0:D10}`r`nEndHTML:{1:D10}`r`nStartFragment:{2:D10}`r`nEndFragment:{3:D10}`r`n"
$pre = "<html><body>`r`n<!--StartFragment-->"
$post = "<!--EndFragment-->`r`n</body></html>"
$dummy = $header -f 0, 0, 0, 0
$lenH = [Text.Encoding]::UTF8.GetByteCount($dummy)
$lenPre = $lenH + [Text.Encoding]::UTF8.GetByteCount($pre)
$lenFrag = [Text.Encoding]::UTF8.GetByteCount($Mml)
$lenPost = [Text.Encoding]::UTF8.GetByteCount($post)
$real = $header -f 0, ($lenH + $lenPre + $lenFrag + $lenPost), $lenPre, ($lenPre + $lenFrag)
$cf = $real + $pre + $Mml + $post
$do = New-Object Windows.Forms.DataObject
$do.SetText($cf, [Windows.Forms.TextDataFormat]::Html)
$do.SetText($Mml, [Windows.Forms.TextDataFormat]::UnicodeText)
[Windows.Forms.Clipboard]::SetDataObject($do, $true)

$winword = 'C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE'
$hadWord = [bool](Get-Process WINWORD -ErrorAction SilentlyContinue)
if (-not $hadWord) { Start-Process $winword -ArgumentList '/q', '/n' | Out-Null; Start-Sleep 4 }

$job = Start-Job -ScriptBlock {
  param($pdf, $hadWord)
  $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
  $word.Visible = $false
  $word.DisplayAlerts = 0
  try {
    $doc = $word.Documents.Add()
    $doc.ActiveWindow.Selection.Paste() | Out-Null
    $om = $doc.OMaths.Count
    $doc.GetType().InvokeMember("SaveAs2", [Reflection.BindingFlags]::InvokeMethod, $null, $doc, @($pdf)) | Out-Null
    $doc.Close(0)
    "OK OMaths=$om Pdf=$pdf"
  } catch { "ERR " + $_.Exception.Message }
}
if (Wait-Job $job -Timeout $TimeoutSec) { Receive-Job $job }
else { Stop-Job $job; "TIMEOUT" }
Remove-Job $job -Force
try {
  $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
  if (-not $hadWord -and $word.Documents.Count -eq 0) { $word.Quit() }
} catch {}
