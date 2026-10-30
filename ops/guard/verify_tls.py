"""Verify the actual HTTPS vhost on the VPS, with normal certificate validation."""
import http.client
import socket
import ssl
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
def fetch(path='/?when=today',extra=None,method='GET'):
    conn=http.client.HTTPSConnection('evryvibe.com',context=ssl.create_default_context(),timeout=30)
    conn._create_connection=lambda address,timeout=30,source_address=None: socket.create_connection(('127.0.0.1',443),timeout,source_address)
    headers={'User-Agent':UA};headers.update(extra or {})
    conn.request(method,path,headers=headers,body=b'' if method=='POST' else None)
    response=conn.getresponse();status=response.status;h=response.getheaders();body=response.read().decode();conn.close()
    return status,h,body
suspect={'Referer':'https://www.google.com/','Sec-Fetch-Site':'none','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'}
assert fetch(extra=suspect)[0]==403
assert fetch(extra={**suspect,'Sec-Fetch-Site':'cross-site','Sec-Fetch-User':'?1'})[0]==200
status,h,_=fetch('/_evg/pass',{'Origin':'https://evryvibe.com','Referer':'https://evryvibe.com/?when=today'},'POST')
assert status==303
values=[value for key,value in h if key.lower()=='set-cookie']
assert len(values)==2 and all('; Secure' in value and '; HttpOnly' in value and '; SameSite=Lax' in value for value in values)
cookies='; '.join(value.split(';',1)[0] for value in values)
assert fetch(extra={**suspect,'Cookie':cookies})[0]==200
assert fetch(extra={**suspect,'Cookie':cookies,'User-Agent':UA+' changed'})[0]==403
assert fetch('/mcp')[0]==401
assert fetch('/.well-known/oauth-authorization-server')[0]==200
assert fetch('/api/health')[0]==200
assert fetch(extra={'User-Agent':'Googlebot/2.1',**suspect})[0]==200
print('Actual TLS vhost: suspicious403, normal200, valid pass200, changed UA403, Secure/HttpOnly cookies; MCP401, OAuth200, health200, crawler200')
