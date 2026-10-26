#!/usr/bin/env bash
# 部署前给静态资源打版本号(cache-busting)。只改当前工作副本(CI runner 上的 checkout),
# 不提交源码 —— 本地开发照常用裸路径。版本号默认取当前 commit 短 SHA。
# 用法: bash scripts/cache_bust.sh [版本号]
set -euo pipefail
export V="${1:-$(git rev-parse --short HEAD)}"

# 1) HTML 中的静态资源统一使用本次部署版本（同时替换旧版本参数）。
perl -0777 -pi -e 's{(href|src)="(assets/[^"?]+\.(?:css|js))(?:\?[^"\s]*)?"}{qq{$1="$2?v=$ENV{V}"}}ge' ./*.html

# 2) 整条 ES module 依赖链追加版本；支持 js/mjs 与单双引号
perl -0777 -pi -e 's{from(\s+)(["\x27])(\./[^"\x27?]+\.(?:js|mjs))(?:\?[^"\x27]*)?\2}{qq{from$1$2$3?v=$ENV{V}$2}}ge' assets/*.js assets/*.mjs

# Public/private entry points load their modules dynamically; version those too.
perl -0777 -pi -e 's{import\((["\x27])(\./[^"\x27?]+\.(?:js|mjs))(?:\?[^"\x27]*)?\1\)}{qq{import($1$2?v=$ENV{V}$1)}}ge' assets/*.js assets/*.mjs

echo "cache-bust v=$V 已应用"
