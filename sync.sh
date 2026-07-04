#!/bin/bash
# 竹杖芒鞋 · 构建并部署到测试 vault
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VAULT_DIR="$SCRIPT_DIR/../../CJ/obsidian-vault/.obsidian/plugins/bamboo-walking"

MODE="${1:---prod}"
cd "$SCRIPT_DIR"

if [ "$MODE" = "--dev" ]; then
  echo "🎋 开发模式..."
  npm run build:dev
else
  echo "🎋 生产模式..."
  npm run build
fi

echo "📦 同步到 vault..."
mkdir -p "$VAULT_DIR"

if [ -f "$VAULT_DIR/data.json" ]; then
  cp "$VAULT_DIR/data.json" /tmp/bamboo-walking-data.json
fi

cp main.js "$VAULT_DIR/"
cp styles.css "$VAULT_DIR/"
cp manifest.json "$VAULT_DIR/"

if [ -f /tmp/bamboo-walking-data.json ]; then
  cp /tmp/bamboo-walking-data.json "$VAULT_DIR/data.json"
  rm /tmp/bamboo-walking-data.json
fi

echo "✅ 同步完成 → $VAULT_DIR"
echo "   main.js: $(wc -c < main.js | tr -d ' ') bytes"
