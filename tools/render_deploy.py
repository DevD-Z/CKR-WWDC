import urllib.request, json

api_key = 'rnd_TzmuPXxUvEjQKlTDLvAzL7MyBPwI'

headers = {
    'Authorization': 'Bearer ' + api_key,
    'Content-Type': 'application/json'
}

# First, check existing services
req = urllib.request.Request('https://api.render.com/v1/services', headers=headers)
try:
    resp = urllib.request.urlopen(req)
    services = json.loads(resp.read())
    print(f'Existing services: {len(services)}')
    for s in services:
        print(f'  - {s.get("service",{}).get("name")} ({s.get("service",{}).get("id")})')
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f'List services error: {e.code}')
    print(body[:500])
