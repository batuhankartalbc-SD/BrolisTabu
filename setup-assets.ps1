<#
  setup-assets.ps1
  ------------------------------------------------------------------------
  Brolis Tabu icin tek seferlik varlik (asset) kurulumu. Iki isi yapar:

    1) iOS "Ana Ekrana Ekle" ikonu ve PWA manifest ikonlari icin gercek PNG
       dosyalari uretir (icon-180.png, icon-192.png, icon-512.png) — icon.svg
       ile ayni vintage ahsap/bronz tasarimda. iOS Safari apple-touch-icon
       icin SVG kabul etmiyor, PNG sart.
    2) React ve React-DOM'u vendor/ klasorune indirir; boylece index.html
       once yerel kopyayi dener, yoksa (veya bu betik hic calistirilmadiysa)
       sessizce CDN'e (unpkg) duser. Ya calistirirsin ya calistirmazsin,
       uygulama her iki durumda da bozulmadan calisir.

  Kullanim (proje klasorunde):
    powershell -ExecutionPolicy Bypass -File .\setup-assets.ps1

  Not: Bu betik yalnizca senin kendi makinende, kendi PowerShell'inde
  calistirilmak icin yazildi.
#>

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

Write-Output "== Brolis Tabu varlik kurulumu basliyor =="

# ---------------------------------------------------------------------------
# 1) PNG ikonlar (icon.svg ile ayni vintage tasarim: koyu ceviz zemin +
#    bronz cift cerceve + altin "T")
# ---------------------------------------------------------------------------
Add-Type -AssemblyName System.Drawing

function New-TabuIconPng {
    param(
        [int]$Size,
        [string]$OutPath
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Tam kare, opak zemin - iOS kendi kose maskesini kendisi uygular,
    # onceden yuvarlatilmis kose vermek cift maskeleme/kirpilma sorunu yaratir.
    $bgColor = [System.Drawing.ColorTranslator]::FromHtml("#17100B")
    $bgBrush = New-Object System.Drawing.SolidBrush($bgColor)
    $g.FillRectangle($bgBrush, 0, 0, $Size, $Size)

    # Disaridaki kalin bronz cerceve
    $bronzeOuter = [System.Drawing.ColorTranslator]::FromHtml("#D1AC62")
    $outerWidth = [Math]::Max(2, [int]($Size * 0.027))
    $outerInset = [int]($Size * 0.031)
    $penOuter = New-Object System.Drawing.Pen($bronzeOuter, $outerWidth)
    $g.DrawRectangle($penOuter, $outerInset, $outerInset, ($Size - 2 * $outerInset), ($Size - 2 * $outerInset))

    # Icerideki ince bronz cizgi
    $bronzeInner = [System.Drawing.ColorTranslator]::FromHtml("#8F6A31")
    $innerInset = [int]($Size * 0.066)
    $penInner = New-Object System.Drawing.Pen($bronzeInner, [Math]::Max(1, [int]($Size * 0.006)))
    $g.DrawRectangle($penInner, $innerInset, $innerInset, ($Size - 2 * $innerInset), ($Size - 2 * $innerInset))

    # Ortada altin "T" harfi
    $accent = [System.Drawing.ColorTranslator]::FromHtml("#E1C48A")
    $fontSize = [single]($Size * 0.52)
    $font = New-Object System.Drawing.Font("Georgia", $fontSize, [System.Drawing.FontStyle]::Bold)
    $textBrush = New-Object System.Drawing.SolidBrush($accent)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(0, 0, $Size, ($Size * 1.08))
    $g.DrawString("T", $font, $textBrush, $rect, $format)

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose()
    $bmp.Dispose()
    $penOuter.Dispose()
    $penInner.Dispose()
    $font.Dispose()
    $bgBrush.Dispose()
    $textBrush.Dispose()

    Write-Output "  olusturuldu: $OutPath ($Size x $Size)"
}

Write-Output "-- PNG ikonlar uretiliyor --"
New-TabuIconPng -Size 180 -OutPath (Join-Path $root "icon-180.png")
New-TabuIconPng -Size 192 -OutPath (Join-Path $root "icon-192.png")
New-TabuIconPng -Size 512 -OutPath (Join-Path $root "icon-512.png")

# ---------------------------------------------------------------------------
# 2) React / React-DOM'u yerel vendor/ klasorune indir
# ---------------------------------------------------------------------------
Write-Output "-- React dosyalari indiriliyor --"
$vendorDir = Join-Path $root "vendor"
New-Item -ItemType Directory -Force -Path $vendorDir | Out-Null

$ProgressPreference = "SilentlyContinue"
try {
    Invoke-WebRequest -Uri "https://unpkg.com/react@18/umd/react.production.min.js" -OutFile (Join-Path $vendorDir "react.production.min.js") -UseBasicParsing
    Invoke-WebRequest -Uri "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" -OutFile (Join-Path $vendorDir "react-dom.production.min.js") -UseBasicParsing
    Write-Output "  vendor/react.production.min.js ve vendor/react-dom.production.min.js indirildi."
} catch {
    Write-Output "  UYARI: React dosyalari indirilemedi (internet baglantisini kontrol et)."
    Write-Output "  Sorun degil - uygulama bu durumda otomatik olarak CDN'den yuklemeye devam eder."
}

Write-Output "== Kurulum tamamlandi =="
Write-Output "Simdi index.html'i (veya siteyi) actiginda: iOS ikonu gercek bir PNG olacak"
Write-Output "ve React yerelden, offline dahil calisacak."
