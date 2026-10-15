# EqLens MathML -> REAL Microsoft Word paste E2E test (bypasses WPS COM hijack)
# Launches WINWORD.EXE directly and attaches via GetActiveObject (ROT lookup by CLSID).
# Usage: powershell -STA -NoProfile -File word-paste2.ps1 -MmlFile <file> [-TimeoutSec 40]
param(
  [Parameter(Mandatory = $true)][string]$MmlFile,
  [int]$TimeoutSec = 40
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$winword = 'C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE'
$Mml = [IO.File]::ReadAllText($MmlFile)

# CF_HTML payload
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

$hadWord = [bool](Get-Process WINWORD -ErrorAction SilentlyContinue)
if (-not $hadWord) { Start-Process $winword -ArgumentList '/q', '/n' | Out-Null; Start-Sleep 4 }

$job = Start-Job -ScriptBlock {
  $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $fresh = -not $hadWord
  try {
    $doc = $word.Documents.Add()
    $doc.ActiveWindow.Selection.Paste() | Out-Null
    $om = $doc.OMaths.Count
    $mt = @($doc.InlineShapes | Where-Object { $_.OLEFormat.ProgId -match 'Equation|MathType' }).Count
    $txt = $doc.Content.Text.Trim()
    $doc.Close(0)
    $t = if ($txt.Length -gt 70) { $txt.Substring(0, 70) } else { $txt }
    "OK OMaths=$om MathTypeOLE=$mt Text=[$t]"
  } catch {
    "ERR " + $_.Exception.Message
  }
}

if (Wait-Job $job -Timeout $TimeoutSec) {
  Receive-Job $job
} else {
  Stop-Job $job
  "TIMEOUT paste blocked by modal dialog (MathType error signature)"
}
Remove-Job $job -Force
# teardown: only quit an instance we started fresh and that has no docs left
try {
  $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
  if (-not $hadWord -and $word.Documents.Count -eq 0) { $word.Quit() }
} catch { Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { -not $hadWord } | Stop-Process -Force }
