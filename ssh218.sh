#!/bin/bash
# 腾讯云 124.222.96.218 SSH helper
# 用法: ./ssh218.sh "命令"
# 或者: ./ssh218.sh          (打开交互式 shell)
set -e

export SSHPASS='yuan340364#'

if [ $# -eq 0 ]; then
    # 交互式
    sshpass -e ssh \
      -o StrictHostKeyChecking=no \
      -o ConnectTimeout=15 \
      -o PreferredAuthentications=password \
      -o PubkeyAuthentication=no \
      -o ProxyCommand="socat - PROXY:127.0.0.1:%h:%p,proxyport=18080" \
      admin@124.222.96.218
else
    # 执行命令
    sshpass -e ssh \
      -o StrictHostKeyChecking=no \
      -o ConnectTimeout=15 \
      -o PreferredAuthentications=password \
      -o PubkeyAuthentication=no \
      -o ProxyCommand="socat - PROXY:127.0.0.1:%h:%p,proxyport=18080" \
      admin@124.222.96.218 "$@"
fi
