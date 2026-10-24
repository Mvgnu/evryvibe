#!/usr/bin/env bash
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo "Run as root after DNS is configured." >&2; exit 1; }
[[ "$#" -le 1 ]] || { echo "Usage: enable-https.sh [ACME_CONTACT_EMAIL]" >&2; exit 1; }
contact="${1:-legal@evryvibe.com}"
command -v dig >/dev/null
command -v certbot >/dev/null
command -v curl >/dev/null
command -v openssl >/dev/null
nginx -t
install -d -m 0755 /var/www/letsencrypt/.well-known/acme-challenge
# DNS may legitimately publish proxy addresses, including IPv6. Prove that
# every address returned by both public resolvers serves this origin's webroot
# before asking ACME to validate it. Never bypass routing checks for a proxy.
probe_token=$(openssl rand -hex 32)
probe_file="/var/www/letsencrypt/.well-known/acme-challenge/evryvibe-preflight-$probe_token"
trap 'rm -f -- "$probe_file"' EXIT
printf '%s' "$probe_token" >"$probe_file"
chmod 0644 "$probe_file"
for domain in evryvibe.com www.evryvibe.com; do
  for resolver in 1.1.1.1 8.8.8.8; do
    addresses=$(dig +noall +answer +time=3 +tries=1 "@$resolver" "$domain" A | awk '$4 == "A" {print $5}')
    [[ -n "$addresses" ]] || {
      echo "No public A records for $domain at $resolver." >&2; exit 1;
    }
    ipv6_addresses=$(dig +noall +answer +time=3 +tries=1 "@$resolver" "$domain" AAAA | awk '$4 == "AAAA" {print $5}')
    while IFS= read -r address; do
      [[ -n "$address" ]] || continue
      endpoint="$address"
      [[ "$address" != *:* ]] || endpoint="[$address]"
      if ! body=$(curl --noproxy '*' --fail --silent --show-error \
        --connect-timeout 5 --max-time 15 --proto '=http' \
        --resolve "$domain:80:$endpoint" \
        "http://$domain/.well-known/acme-challenge/evryvibe-preflight-$probe_token") \
        || [[ "$body" != "$probe_token" ]]; then
        echo "Origin challenge failed for $domain via $address ($resolver). Check DNS/proxy routing." >&2
        exit 1
      fi
    done <<<"$addresses
$ipv6_addresses"
  done
done
rm -f -- "$probe_file"
trap - EXIT
certbot certonly --webroot -w /var/www/letsencrypt --cert-name evryvibe.com \
  -d evryvibe.com -d www.evryvibe.com --email "$contact" --agree-tos --non-interactive
site=/etc/nginx/sites-available/evryvibe
[[ -f "$site" && ! -L "$site" ]] || { echo "Expected existing regular site file: $site" >&2; exit 1; }
backup=$(mktemp /etc/nginx/sites-available/.evryvibe-backup.XXXXXXXX)
cp -p -- "$site" "$backup"
restore() { cp -p -- "$backup" "$site"; rm -f -- "$backup"; }
trap restore EXIT
install -m 0644 /etc/evryvibe/nginx-https.conf "$site"
nginx -t
systemctl reload nginx
rm -f -- "$backup"
trap - EXIT
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat >/etc/letsencrypt/renewal-hooks/deploy/evryvibe-reload-nginx <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx
HOOK
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/evryvibe-reload-nginx
systemctl enable --now certbot.timer
echo "HTTPS configured. Verify both hosts and run certbot renew --dry-run."
