import socket, time, paramiko

proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
resp = b''
while b'\r\n\r\n' not in resp:
    chunk = proxy.recv(4096)
    if not chunk: break
    resp += chunk
time.sleep(0.8)

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('43.133.232.81', username='ubuntu', password='yuan340364#', sock=proxy)

# Test Edge Functions via REST API (through envoy on port 8000)
cmd = """
echo '=== Test generate-label-pdf ===' && \
curl -s -X POST https://thalvior.icu/functions/v1/generate-label-pdf \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
  -d '{"outbound_id": "550e8400-e29b-41d4-a716-446655440000", "receiver_name": "张三", "receiver_address": "123 Main St, New York", "receiver_phone": "13800138000", "weight_kg": 1.5, "carrier": "DHL", "tracking_no": "TEST123456"}' \
  2>&1 | head -c 500

echo ''
echo '=== Test health ===' && \
curl -s https://thalvior.icu/rest/v1/ 2>&1 | head -c 200
"""
print('Testing...')
stdin, stdout, stderr = ssh.exec_command(cmd)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err[:500])

ssh.close()
