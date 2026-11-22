#!/bin/bash
# 43.133.232.81 (thalvior.icu) Ubuntu SSH helper
set -e
export SSHPASS='Yuan340364#'

if [ $# -eq 0 ]; then
    sshpass -e ssh \
      -o StrictHostKeyChecking=no -o ConnectTimeout=15 \
      -o PreferredAuthentications=password -o PubkeyAuthentication=no \
      -o "ProxyCommand=socat - PROXY:127.0.0.1:%h:%p,proxyport=18080" \
      ubuntu@43.133.232.81
else
    sshpass -e ssh \
      -o StrictHostKeyChecking=no -o ConnectTimeout=15 \
      -o PreferredAuthentications=password -o PubkeyAuthentication=no \
      -o "ProxyCommand=socat - PROXY:127.0.0.1:%h:%p,proxyport=18080" \
      ubuntu@43.133.232.81 "$@"
fi
