#!/bin/bash
# 腾讯云 124.222.96.218 ROOT SSH helper
set -e
export SSHPASS='yuan340364#'

if [ $# -eq 0 ]; then
    sshpass -e ssh \
      -o StrictHostKeyChecking=no -o ConnectTimeout=15 \
      -o PreferredAuthentications=password -o PubkeyAuthentication=no \
      -o ProxyCommand="socat - PROXY:127.0.0.1:%h:%p,proxyport=18080" \
      root@124.222.96.218
else
    sshpass -e ssh \
      -o StrictHostKeyChecking=no -o ConnectTimeout=15 \
      -o PreferredAuthentications=password -o PubkeyAuthentication=no \
      -o ProxyCommand="socat - PROXY:127.0.0.1:%h:%p,proxyport=18080" \
      root@124.222.96.218 "$@"
fi
