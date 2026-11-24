import socket, time, sys

proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
resp = b''
while b'\r\n\r\n' not in resp:
    chunk = proxy.recv(4096)
    if not chunk: break
    resp += chunk
time.sleep(0.5)

import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('43.133.232.81', username='ubuntu', password='yuan340364#', sock=proxy)

fix = """
DROP FUNCTION IF EXISTS tlv_calc_employee_performance(uuid,date,date);

CREATE OR REPLACE FUNCTION tlv_calc_employee_performance(
  p_warehouse_id uuid,
  p_start_date date,
  p_end_date date
) RETURNS TABLE(
  employee_id uuid,
  employee_name text,
  total_packages bigint,
  total_orders bigint,
  total_items bigint,
  issue_handled bigint,
  issue_open bigint,
  revenue numeric,
  period text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.name,
    COALESCE(SUM(op.package_count), 0)::bigint,
    COUNT(DISTINCT op.order_id)::bigint,
    COALESCE(SUM(op.item_count), 0)::bigint,
    COALESCE(SUM(op.issue_count), 0)::bigint,
    (SELECT COUNT(*) FROM tlv_issue_items ii
     WHERE ii.warehouse_id = p_warehouse_id
       AND ii.assigned_to = e.id
       AND ii.status IN ('open','assigned','processing'))::bigint,
    COALESCE(SUM(op.revenue), 0),
    p_start_date::text || '~' || p_end_date::text
  FROM tlv_employees e
  LEFT JOIN tlv_outbound_operations op
    ON op.warehouse_id = p_warehouse_id
    AND op.operator_id = e.id
    AND op.created_at BETWEEN p_start_date AND p_end_date + 1
  WHERE e.warehouse_id = p_warehouse_id
  GROUP BY e.id, e.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

docker restart supabase-rest supabase-envoy;
"""

stdin, stdout, stderr = ssh.exec_command(
    f"docker exec -i supabase-db psql -U supabase_admin -d postgres << 'SQLDELIM'\n{fix}\nSQLDELIM\ndocker restart supabase-rest supabase-envoy",
    timeout=30
)
print(stdout.read().decode())
err = stderr.read().decode()
if err.strip(): print("ERR:", err[:500])
ssh.close()
print("✅ Done")
