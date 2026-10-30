"""Run on the VPS while its temporary loopback-only :3303 test vhost is installed."""
import urllib.request
import urllib.error

BASE='http://127.0.0.1:3303'
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
def fetch(path='/?when=today',headers=None,method='GET'):
    values={'Host':'evryvibe.com','User-Agent':UA}
    values.update(headers or {})
    req=urllib.request.Request(BASE+path,headers=values,method=method,data=b'' if method=='POST' else None)
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args):return None
    try:r=urllib.request.build_opener(NoRedirect).open(req,timeout=30)
    except urllib.error.HTTPError as e:r=e
    return r.status,r.headers,r.read().decode()
status,headers,body=fetch(headers={'X-EVG-Test':'block'})
assert status==403 and 'Bitte bestätigen' in body
assert 'no-store' in headers.get('Cache-Control','') and 'noindex' in headers.get('X-Robots-Tag','')
print('Private challenge:403, no-store, noindex')
status,headers,body=fetch('/_evg/pass',method='POST',headers={'Origin':'http://evryvibe.com','Referer':'http://evryvibe.com/?when=today'})
assert status==303 and headers['Location']=='/?when=today'
cookies='; '.join(value.split(';',1)[0] for value in headers.get_all('Set-Cookie'))
assert 'HttpOnly' in headers.get_all('Set-Cookie')[0]
assert fetch(headers={'X-EVG-Test':'block','Cookie':cookies})[0]==200
assert fetch(headers={'X-EVG-Test':'block','Cookie':cookies,'User-Agent':UA+' changed'})[0]==403
assert fetch(headers={'X-EVG-Test':'block','Cookie':'evg_h=invalid; evg_e=1'})[0]==403
print('Button:303 to original URL, valid pass200, changed UA/invalid pass403')
assert fetch('/_evg/pass',method='POST',headers={'Origin':'https://attacker.invalid','Sec-Fetch-Site':'cross-site'})[0]==403
print('Cross-origin pass rejected:403')
assert fetch(headers={'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document','Sec-Fetch-User':'?1','Referer':'https://www.google.com/'})[0]==200
print('Normal browser navigation:200')

assert fetch(headers={'Referer':'https://www.google.com/','Sec-Fetch-Site':'none','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'})[0]==403
assert fetch(headers={'Referer':'https://www.google.com/','Sec-Fetch-Site':'none','User-Agent':'Googlebot/2.1'})[0]==200
assert fetch('/icon.svg')[0]==200
print('Enforcement: forged browser/search403, declared crawler200, asset200')
