from pathlib import Path
seen=set()
for name in ['/etc/nginx/sites-enabled/evryvibe','/etc/nginx/sites-available/evryvibe','/etc/evryvibe/nginx-https.conf']:
 p=Path(name).resolve()
 if p in seen:continue
 seen.add(p)
 s=p.read_text()
 if 'include /etc/nginx/evryvibe-cloudflare-realip.conf;' not in s:
  s=s.replace('    server_name evryvibe.com;', '    server_name evryvibe.com;\n    include /etc/nginx/evryvibe-cloudflare-realip.conf;',1)
 if '/evryvibe-guard/server.conf' in s:
  p.write_text(s)
  continue
 start=s.index('    server_name evryvibe.com;')
 loc=s.index('    location / {',start)
 s=s[:loc]+'''    include /etc/nginx/evryvibe-guard/server.conf;
    include /etc/nginx/evryvibe-guard/challenge-locations.conf;
    include /etc/nginx/evryvibe-guard/analytics-locations.conf;
'''+s[loc:]
 loc=s.index('    location / {',start)+len('    location / {')
 s=s[:loc]+'\n        include /etc/nginx/evryvibe-guard/check.conf;'+s[loc:]
 p.write_text(s)
