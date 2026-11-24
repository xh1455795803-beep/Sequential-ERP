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

cmds = [
    # Full trigger
    "docker exec supabase-db psql -U postgres -c \"SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='tlv_deduct_balance_on_create';\"",
    # Try manual insert to see if trigger blocks
    "docker exec -i supabase-db psql -U postgres << 'SQL'\nINSERT INTO tlv_outbound_orders (warehouse_id, merchant_id, order_no, platform, receiver_name, receiver_phone, receiver_address, status, is_cod, cod_amount, weight_kg)\nVALUES ('57ae8979-c77f-4a88-b80a-113f01b5cbee', '7e3bf09f-3937-4891-a6f6-75941f39d1b2', 'TEST-TIKTOK-ORDER', 'TikTok Shop', 'Test Buyer', '+1234567890', '123 Main St, USA', 'pending', false, null, 0.5)\nRETURNING id, status, balance_deducted, estimated_fee, merchant_note;\nSQL",
    "docker exec supabase-db psql -U postgres -c \"DELETE FROM tlv_outbound_orders WHERE order_no='TEST-TIKTOK-ORDER';\"",
]
for c in cmds:
    print()
    print("=" * 50)
    stdin, stdout, stderr = ssh.exec_command(c)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err: print('STDERR:', err[:1000])

ssh.close()
