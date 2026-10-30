#!/bin/sh
# Run as root with this directory as $1; no secrets leave the host.
set -eu
src=${1:?guard source directory required}
install -d -m 750 /usr/local/lib/evryvibe-guard /etc/nginx/evryvibe-guard
install -d -m 700 /var/lib/evryvibe-guard
install -m 755 "$src/guard.py" /usr/local/lib/evryvibe-guard/guard.py
install -m 644 "$src/policy.json" "$src/prefetch-proxy.txt" /usr/local/lib/evryvibe-guard/
for file in server.conf check.conf challenge-locations.conf analytics-locations.conf; do
    install -m 644 "$src/$file" "/etc/nginx/evryvibe-guard/$file"
done
for file in "$src"/evryvibe-guard*.service "$src"/evryvibe-guard*.timer; do install -m 644 "$file" /etc/systemd/system/; done
install -m 644 "$src/logrotate.conf" /etc/logrotate.d/evryvibe-guard
python3 - <<'PY'
from pathlib import Path
import secrets,re
root=Path('/etc/nginx/evryvibe-guard')
vars={'mode.conf':('enforce',0),'challenge.conf':('challenge_sw',1),'origin-lock.conf':('origin_lock',0),'old.conf':('old_enforce',1),'pair.conf':('pair_enforce',1),'blind-docs.conf':('blind_docs',1),'sweep.conf':('sweep_enforce',1),'runtime.conf':('runtime_enforce',1)}
for file,(var,default) in vars.items():
 p=root/file
 if not p.exists():p.write_text(f'map $host $evg_{var} {{ default {default}; }}\n')
for file in ['families.map','pairs.map','sweeps.map','runtimes.map']:
 p=root/file
 if not p.exists():p.write_text('# Fresh EVRYVIBE detector; no Leasy fingerprints imported.\n')
p=root/'pass-secret.conf'
if not p.exists():
 p.write_text('map $host $evg_pass_secret { default "'+secrets.token_hex(32)+'"; }\n');p.chmod(0o600)
cf=Path('/etc/nginx/evryvibe-cloudflare-realip.conf').read_text()
(root/'cf-peers.conf').write_text(''.join(f'{ip} 1;\n' for ip in re.findall(r'set_real_ip_from\s+([^;]+);',cf)))
PY
# Provider-public ranges only; never copy the other guard's detection state.
if [ ! -f /etc/nginx/evryvibe-guard/openai.conf ]; then
    install -m 644 "$src/openai-bootstrap.conf" /etc/nginx/evryvibe-guard/openai.conf
fi
python3 - <<'PYNET'
from pathlib import Path
source=Path('/usr/local/lib/evryvibe-guard/prefetch-proxy.txt')
Path('/etc/nginx/evryvibe-guard/prefetch-proxy.conf').write_text(''.join(line.strip()+' 1;\n' for line in source.read_text().splitlines() if line.strip() and not line.startswith('#')))
PYNET
/usr/bin/python3 -I /usr/local/lib/evryvibe-guard/guard.py policy --nginx > /etc/nginx/evryvibe-guard/policy.conf
install -m 644 "$src/evryvibe-guard.conf" /etc/nginx/conf.d/evryvibe-guard.conf
# Guard log is separate from regular access logging (which remains off).
touch /var/log/evryvibe/guard.log
chown www-data:adm /var/log/evryvibe/guard.log
chmod 640 /var/log/evryvibe/guard.log
systemctl daemon-reload
