#!/usr/bin/env python3
import socket
import subprocess
import sys

def connect_via_http_proxy(host, port, proxy_host='127.0.0.1', proxy_port=18080):
    """Connect to host:port via HTTP CONNECT proxy"""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect((proxy_host, proxy_port))
    # Send CONNECT
    s.sendall(f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n".encode())
    # Read response
    response = b''
    while b'\r\n\r\n' not in response:
        chunk = s.recv(4096)
        if not chunk:
            raise ConnectionError("Proxy closed connection")
        response += chunk
    status_line = response.split(b'\r\n')[0].decode()
    if '200' not in status_line:
        raise ConnectionError(f"Proxy failed: {status_line}")
    return s

if __name__ == '__main__':
    # Use paramiko with custom socket
    import paramiko
    import os
    
    sock = connect_via_http_proxy('43.133.232.81', 22)
    
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        '43.133.232.81', port=22,
        username='ubuntu', password='Yuan340364#',
        sock=sock, timeout=30
    )
    
    # Execute command
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'echo hello'
    stdin, stdout, stderr = client.exec_command(cmd, timeout=120)
    print(stdout.read().decode('utf-8', errors='replace'))
    err = stderr.read().decode('utf-8', errors='replace')
    if err:
        print("STDERR:", err, file=sys.stderr)
    
    client.close()
