#!/usr/bin/env bash
# 每 5 秒终止所有 ugrep 进程

while true; do
  pkill ugrep 2>/dev/null || true
  sleep 5
done
