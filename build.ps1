# build.ps1 - 一键打包 New API 为 Linux 二进制
#
# 用法：
#   .\build.ps1                  # 默认 linux/amd64
#   .\build.ps1 -Arch arm64      # ARM 服务器
#   .\build.ps1 -SkipWeb         # 跳过前端构建（前端没改时加快编译）
#
# 产物：dist/new-api  + dist/.env.example
# 服务器只需要：Linux + 数据库（MySQL/PostgreSQL），不需要装 Go/Node

param(
    [ValidateSet('amd64', 'arm64')]
    [string]$Arch = 'amd64',
    [switch]$SkipWeb
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

function Step($msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

# ---------- 1. 前置检查 ----------
Step "检查工具链"
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Write-Host "缺少 go，请先安装 Go 1.25+" -ForegroundColor Red
    exit 1
}
if (-not $SkipWeb -and -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "缺少 npm，请先安装 Node.js 18+（或加 -SkipWeb 跳过前端构建）" -ForegroundColor Red
    exit 1
}
go version
if (-not $SkipWeb) { node --version; npm --version }

# ---------- 2. 构建前端 ----------
if ($SkipWeb) {
    Step "跳过前端构建（-SkipWeb）"
    if (-not (Test-Path "$root\web-next\dist\index.html")) {
        Write-Host "web-next/dist/index.html 不存在，无法跳过前端构建" -ForegroundColor Red
        exit 1
    }
} else {
    Step "构建 web-next 前端"
    Push-Location "$root\web-next"
    try {
        if (-not (Test-Path "node_modules")) {
            npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }
        }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build 失败" }
    } finally {
        Pop-Location
    }
    if (-not (Test-Path "$root\web-next\dist\index.html")) {
        Write-Host "前端构建未产出 web-next/dist/index.html" -ForegroundColor Red
        exit 1
    }
}

# ---------- 3. 交叉编译 Go ----------
Step "交叉编译 Go 二进制 (linux/$Arch)"
$dist = "$root\dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null

$env:CGO_ENABLED = '0'
$env:GOOS = 'linux'
$env:GOARCH = $Arch

$out = "$dist\new-api"
go build -trimpath -ldflags="-s -w" -o $out main.go
if ($LASTEXITCODE -ne 0) {
    Write-Host "go build 失败" -ForegroundColor Red
    exit 1
}

# ---------- 4. 附带 .env.example ----------
Copy-Item "$root\.env.example" "$dist\.env.example" -Force

# ---------- 5. 总结 ----------
$size = "{0:N1} MB" -f ((Get-Item $out).Length / 1MB)
Step "构建完成"
Write-Host "  二进制：$out  ($size, linux/$Arch)" -ForegroundColor Green
Write-Host "  示例：  $dist\.env.example" -ForegroundColor Green
Write-Host ""
Write-Host "下一步：" -ForegroundColor Yellow
Write-Host "  scp dist\new-api dist\.env.example user@server:/opt/new-api/"
Write-Host "  ssh user@server 'cd /opt/new-api && cp .env.example .env && vim .env'"
Write-Host "  ssh user@server 'cd /opt/new-api && chmod +x new-api && ./new-api --log-dir ./logs'"
