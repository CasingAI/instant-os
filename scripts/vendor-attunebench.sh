#!/usr/bin/env bash
set -euo pipefail

# AttuneBench 评测数据集下载脚本
# 数据来源：github.com/Thoughtful-Lab/attunebench 的 "Test Samples/" 目录
# 用法：bash scripts/vendor-attunebench.sh [Sample200|Subsample100|Subsample50|Subsample25|Subsample20]
# 不带参数时下载全部子集。

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/public/assets/attunebench"
REPO="Thoughtful-Lab/attunebench"
BRANCH="main"
BASE="https://raw.githubusercontent.com/${REPO}/${BRANCH}/Test%20Samples"

SUBSETS=(Sample200 Subsample100 Subsample50 Subsample25 Subsample20)
if [ "$#" -gt 0 ]; then
  SUBSETS=("$@")
fi

# 可选：通过本机代理访问 GitHub（海外资源经常被阻断）
PROXY="${HTTP_PROXY:-${https_proxy:-}}"
CURL_OPTS=(-sL)
if [ -n "$PROXY" ]; then
  CURL_OPTS+=(-x "$PROXY")
fi

for subset in "${SUBSETS[@]}"; do
  subset_url_encoded=$(printf '%s' "$subset" | sed 's/ /%20/g')
  out_dir="$DEST/$subset"
  mkdir -p "$out_dir"

  # 通过 GitHub API 列出该子集下的 conversation_*.json 清单
  files=$(curl "${CURL_OPTS[@]}" "https://api.github.com/repos/${REPO}/contents/Test%20Samples/${subset_url_encoded}?ref=${BRANCH}" \
    | grep '"name"' | sed -E 's/.*"name": *"([^"]+)".*/\1/' | grep -E '^conversation_' || true)
  if [ -z "$files" ]; then
    echo "warning: no files found for $subset — skipping"
    continue
  fi

  count=0
  while IFS= read -r file; do
    ver=$(printf '%s' "$file" | sed 's/ /%20/g')
    curl "${CURL_OPTS[@]}" "${BASE}/${subset_url_encoded}/${ver}" -o "$out_dir/$file"
    count=$((count + 1))
  done <<< "$files"

  echo "$subset: $count files -> $out_dir"
done

echo "Done."
