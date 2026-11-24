import paramiko, socket, tarfile, io, os

SERVER = '43.133.232.81'; USER = 'ubuntu'; PASS = 'Yuan340364#'

def proxy_connect(host, port, proxy_host='127.0.0.1', proxy_port=18080):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM); sock.settimeout(30)
    sock.connect((proxy_host, proxy_port))
    sock.sendall(f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n".encode())
    resp = b''
    while b'\r\n\r\n' not in resp:
        chunk = sock.recv(4096)
        if not chunk: break
        resp += chunk
    return sock

print("连接服务器...")
sock = proxy_connect(SERVER, 22)
transport = paramiko.Transport(sock)
transport.connect(username=USER, password=PASS)
ssh = paramiko.SSHClient()
ssh._transport = transport
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

# 打 tar
print("打包 dist...")
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode='w') as tar:
    for root, dirs, files in os.walk('/workspace/wms-app/dist'):
        for f in files:
            local = os.path.join(root, f)
            arc = os.path.relpath(local, '/workspace/wms-app/dist')
            tar.add(local, arcname=arc)
buf.seek(0)

# 上传 tar
print("上传...")
sftp = paramiko.SFTPClient.from_transport(transport)
sftp.putfo(buf, '/tmp/wms_dist.tar.gz')
sftp.close()

# 解压
cmd = "sudo rm -rf /var/www/thalvior/wms/* && sudo tar xzf /tmp/wms_dist.tar.gz -C /var/www/thalvior/wms/ && sudo chown -R www-data:www-data /var/www/thalvior/wms/"
stdin, stdout, stderr = ssh.exec_command(cmd)
print("STDOUT:", stdout.read().decode())
err = stderr.read().decode()
if err: print("STDERR:", err)

transport.close()
print("✅ WMS Web 已部署")
