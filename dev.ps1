#!/usr/bin/env pwsh
# ClawPanel 开发服务器启动脚本

Write-Host "🚀 启动 ClawPanel 开发服务器..." -ForegroundColor Cyan

# 检查 Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ 未找到 Node.js，请先安装" -ForegroundColor Red
    exit 1
}

# 检查 Rust
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "❌ 未找到 Rust，请先安装" -ForegroundColor Red
    exit 1
}

# 检查依赖
if (-not (Test-Path "node_modules")) {
    Write-Host "📦 安装前端依赖..." -ForegroundColor Yellow
    npm install
}

if (-not (Test-Path "src-tauri/target")) {
    Write-Host "🦀 首次编译 Rust（可能需要几分钟）..." -ForegroundColor Yellow
}

# 启动开发服务器
Write-Host "✨ 启动中..." -ForegroundColor Green
npm run tauri dev
