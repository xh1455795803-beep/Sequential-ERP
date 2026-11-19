import paramiko
import sys

def ssh_exec(cmd, timeout=30):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        '43.133.232.81', port=22,
        username='ubuntu', password='Yuan340364#',
        timeout=timeout,
        sock=paramiko.ProxyCommand("nc -X connect -x 127.0.0.1:18080 %h %p")
    )
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()
    client.close()
    return code, out, err

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'echo hello'
    code, out, err = ssh_exec(cmd, timeout=int(sys.argv[2]) if len(sys.argv) > 2 else 30)
    print(f"EXIT: {code}")
    if out:
        print("STDOUT:")
        print(out)
    if err:
        print("STDERR:")
        print(err)
