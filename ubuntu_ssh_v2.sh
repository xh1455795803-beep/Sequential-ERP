#!/bin/bash
# SSH helper using expect (sshpass unavailable)
set -e
PASS='Yuan340364#'
HOST='43.133.232.81'
USER='ubuntu'
TMP=/tmp/expect_ssh_$$

mkdir -p /tmp

# 写 expect script
cat > /tmp/exp_ssh.sh << 'EXPEOF'
#!/usr/bin/env expect
set timeout 30
set cmd [lindex $argv 0]
spawn socat - PROXY:127.0.0.1:${HOST}:%p,proxyport=18080
# but we need different approach... let's just use expect with ProxyCommand directly
EXPEOF
chmod +x /tmp/exp_ssh.sh

if [ $# -eq 0 ]; then
  ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 \
      -o PreferredAuthentications=password -o PubkeyAuthentication=no \
      -o "ProxyCommand=socat - PROXY:127.0.0.1:%h:%p,proxyport=18080" \
      ubuntu@43.133.232.81
else
  ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 \
      -o PreferredAuthentications=password -o PubkeyAuthentication=no \
      -o "ProxyCommand=socat - PROXY:127.0.0.1:%h:%p,proxyport=18080" \
      ubuntu@43.133.232.81 "$@"
fi
