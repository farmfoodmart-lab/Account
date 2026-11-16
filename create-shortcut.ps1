# ติดตั้งทางลัด "Accounting" (ไอคอนโลโก้) บนเดสก์ท็อป — เรียกจาก ติดตั้งทางลัด.bat
# ทางลัดจะเรียกไฟล์นี้อีกครั้งด้วย -Run เพื่อรัน web server ในเครื่อง (http://localhost:8765)
# แล้วเปิดแอปในหน้าต่าง Edge/Chrome (ES Modules เปิดแบบ file:// ไม่ได้ จึงต้องมี server)
param([switch]$Run, [switch]$NoBrowser, [int]$Port = 8765)

$root = $PSScriptRoot.TrimEnd('\')

if (-not $Run) {
  $shell = New-Object -ComObject WScript.Shell
  $path = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Accounting.lnk'
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Run"
  $shortcut.WorkingDirectory = $root
  $shortcut.IconLocation = "$root\src\assets\app-icon.ico,0"
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'ระบบบัญชีคู่'
  $shortcut.Save()
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show("สร้างทางลัด Accounting บนเดสก์ท็อปเรียบร้อยแล้ว", 'ติดตั้งทางลัด')
  return
}

# ---------- -Run: รัน server แล้วเปิดแอป ----------
$baseUrl = "http://localhost:$Port/"
$startUrl = "${baseUrl}pages/dashboard/dashboard.html"

function Open-App {
  if ($NoBrowser) { return }
  $browser = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($browser) { Start-Process $browser "--app=$startUrl" } else { Start-Process $startUrl }
}

# server รันอยู่แล้ว → เปิดหน้าต่างแอปอย่างเดียว
try { $probe = New-Object Net.Sockets.TcpClient; $probe.Connect('127.0.0.1', $Port); $probe.Close(); Open-App; return } catch { }

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
  '.ico' = 'image/x-icon'; '.woff2' = 'font/woff2'; '.csv' = 'text/csv; charset=utf-8'
}

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add($baseUrl)
$listener.Start()
Open-App

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $response = $context.Response
  try {
    $relative = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
    if (-not $relative) { $relative = 'Accounting.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $relative))
    if (-not $file.StartsWith("$root\", [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
      $response.StatusCode = 404
    } else {
      $bytes = [IO.File]::ReadAllBytes($file)
      $type = $mime[[IO.Path]::GetExtension($file).ToLowerInvariant()]
      $response.ContentType = $(if ($type) { $type } else { 'application/octet-stream' })
      $response.Headers.Add('Cache-Control', 'no-cache')
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch {
    try { $response.StatusCode = 500 } catch { }
  } finally {
    $response.Close()
  }
}
