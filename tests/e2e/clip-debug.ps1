# Clipboard HTML roundtrip debug + Word paste (ASCII only)
param([string]$MmlFile = ".tmp-e2e/trivial.mml")
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
[Windows.Forms.Clipboard]::SetDataObject($do, $true)

$back = [Windows.Forms.Clipboard]::GetText([Windows.Forms.TextDataFormat]::Html)
Write-Output ("readback.length=" + $back.Length)
Write-Output ("readback.first200=" + $back.Substring(0, [Math]::Min(200, $back.Length)))
Write-Output ("readback.hasMath=" + ($back -match '<math'))

$job = Start-Job -ScriptBlock {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  try {
    $doc = $word.Documents.Add()
    $doc.ActiveWindow.Selection.Paste() | Out-Null
    $om = $doc.OMaths.Count
    $txt = $doc.Content.Text.Trim()
    $doc.Close(0)
    "OK OMaths=$om Text=[$txt]"
  } catch { "ERR " + $_.Exception.Message }
  finally { try { $word.Quit() } catch {} }
}
if (Wait-Job $job -Timeout 30) { Receive-Job $job }
else { Stop-Job $job; "TIMEOUT"; Get-Process WINWORD -ErrorAction SilentlyContinue | Stop-Process -Force }
Remove-Job $job -Force
