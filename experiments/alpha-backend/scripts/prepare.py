#!/usr/bin/env python3
"""Create a private, loopback-only Supabase proof installation."""
import base64, hashlib, hmac, json, os, secrets, shutil, socket, subprocess, time
from pathlib import Path
from proof_docker import docker_run, require_lifecycle_intent
require_lifecycle_intent()
ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.private'
PORTS = {'gateway': 56581, 'database': 56582}
if shutil.disk_usage(ROOT).free < 14 * 2**30:
    raise SystemExit('Refuse startup: preserve 12 GiB plus 2 GiB growth allowance.')
for port in PORTS.values():
    with socket.socket() as sock:
        try: sock.bind(('127.0.0.1', port))
        except OSError: raise SystemExit(f'Port {port} is already in use. Inspect the owner before startup.')
PRIVATE.mkdir(mode=0o700, exist_ok=True)
credentials = PRIVATE / 'credentials.json'
if not credentials.exists():
    secret = secrets.token_hex(32)
    def jwt(role):
        b64 = lambda v: base64.urlsafe_b64encode(json.dumps(v,separators=(',', ':')).encode()).decode().rstrip('=')
        payload = b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'role':role,'iss':'supabase','iat':int(time.time()),'exp':int(time.time())+30*86400})
        signature = base64.urlsafe_b64encode(hmac.new(secret.encode(),payload.encode(),hashlib.sha256).digest()).decode().rstrip('=')
        return payload+'.'+signature
    values={'POSTGRES_PASSWORD':secrets.token_hex(24),'JWT_SECRET':secret,'ANON_KEY':jwt('anon'),'SERVICE_ROLE_KEY':jwt('service_role'),'PG_META_CRYPTO_KEY':secrets.token_hex(32),'DASHBOARD_USERNAME':'trellis','DASHBOARD_PASSWORD':secrets.token_hex(24)}
    credentials.write_text(json.dumps(values,indent=2)+'\n'); credentials.chmod(0o600)
values=json.loads(credentials.read_text())
env=PRIVATE/'stack.env';env.write_text(''.join(k+'='+v+'\n' for k,v in values.items()));env.chmod(0o600)
images=json.loads((ROOT/'infra/images.json').read_text())
for image in images.values():
    docker_run(['image','inspect',image['digest']],check=True,stdout=subprocess.DEVNULL)
base=lambda service,mem:{'image':images[service]['digest'],'pull_policy':'never','restart':'unless-stopped','mem_limit':mem,'cpus':1,'logging':{'driver':'json-file','options':{'max-size':'5m','max-file':'2'}}}
services={k:base(k,mem) for k,mem in {'db':'384m','meta':'192m','studio':'512m','rest':'96m','gateway':'192m'}.items()}
services['db'].update({'environment':{'POSTGRES_HOST':'/var/run/postgresql','PGPORT':5432,'POSTGRES_PORT':5432,'POSTGRES_DB':'postgres','PGDATABASE':'postgres','POSTGRES_PASSWORD':'${POSTGRES_PASSWORD:?}','PGPASSWORD':'${POSTGRES_PASSWORD:?}','JWT_EXP':3600},'ports':['127.0.0.1:56582:5432'],'volumes':['trellis-data:/var/lib/postgresql/data','trellis-db-config:/etc/postgresql-custom','./roles.sql:/docker-entrypoint-initdb.d/init-scripts/99-roles.sql:ro','./jwt.sql:/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql:ro'],'command':['postgres','-c','config_file=/etc/postgresql/postgresql.conf','-c','shared_buffers=64MB','-c','max_connections=50'],'healthcheck':{'test':['CMD','pg_isready','-U','postgres','-h','localhost'],'interval':'2s','timeout':'2s','retries':45}})
dbready={'db':{'condition':'service_healthy'}}
services['meta'].update({'depends_on':dbready,'environment':{'PG_META_PORT':8080,'PG_META_DB_HOST':'db','PG_META_DB_PORT':5432,'PG_META_DB_NAME':'postgres','PG_META_DB_USER':'postgres','PG_META_DB_PASSWORD':'${POSTGRES_PASSWORD:?}','CRYPTO_KEY':'${PG_META_CRYPTO_KEY:?}'}})
services['rest'].update({'depends_on':dbready,'environment':{'PGRST_DB_URI':'postgres://authenticator:${POSTGRES_PASSWORD:?}@db:5432/postgres','PGRST_DB_SCHEMAS':'public','PGRST_DB_ANON_ROLE':'anon','PGRST_JWT_SECRET':'${JWT_SECRET:?}','PGRST_DB_USE_LEGACY_GUCS':'false','PGRST_APP_SETTINGS_JWT_SECRET':'${JWT_SECRET:?}','PGRST_APP_SETTINGS_JWT_EXP':3600}})
services['studio'].update({'depends_on':{'meta':{'condition':'service_started'}},'environment':{'HOSTNAME':'0.0.0.0','STUDIO_PG_META_URL':'http://meta:8080','POSTGRES_HOST':'db','POSTGRES_PORT':5432,'POSTGRES_DB':'postgres','POSTGRES_PASSWORD':'${POSTGRES_PASSWORD:?}','POSTGRES_USER_READ_WRITE':'postgres','PG_META_CRYPTO_KEY':'${PG_META_CRYPTO_KEY:?}','PGRST_DB_SCHEMAS':'public','DEFAULT_ORGANIZATION_NAME':'Trellis Alpha Proof','DEFAULT_PROJECT_NAME':'Endor Synthetic Proof','SUPABASE_URL':'http://gateway:8000','SUPABASE_PUBLIC_URL':'http://127.0.0.1:56581','SUPABASE_ANON_KEY':'${ANON_KEY:?}','SUPABASE_SERVICE_KEY':'${SERVICE_ROLE_KEY:?}','AUTH_JWT_SECRET':'${JWT_SECRET:?}','OPENAI_API_KEY':'','NEXT_PUBLIC_ENABLE_LOGS':'false','ENABLED_FEATURES_LOGS_ALL':'false','NEXT_PUBLIC_IS_PLATFORM':'false'},'healthcheck':{'test':['CMD','node','-e',"fetch('http://127.0.0.1:3000/api/platform/profile').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"],'interval':'5s','timeout':'3s','retries':30}})
gateway={'_format_version':'2.1','_transform':True,'consumers':[{'username':values['DASHBOARD_USERNAME'],'basicauth_credentials':[{'username':values['DASHBOARD_USERNAME'],'password':values['DASHBOARD_PASSWORD']}]}],'services':[{'name':'studio','url':'http://studio:3000/','routes':[{'name':'studio','paths':['/'],'strip_path':False}],'plugins':[{'name':'basic-auth','config':{'hide_credentials':True}}]},{'name':'rest','url':'http://rest:3000/','routes':[{'name':'rest','paths':['/rest/v1/'],'strip_path':True}]}]}
gatewayfile=PRIVATE/'gateway.json';gatewayfile.write_text(json.dumps(gateway,indent=2)+'\n');gatewayfile.chmod(0o600)
services['gateway'].update({'depends_on':{'studio':{'condition':'service_healthy'}},'environment':{'KONG_DATABASE':'off','KONG_DECLARATIVE_CONFIG':'/private/gateway.json','KONG_DNS_ORDER':'LAST,A,CNAME','KONG_PLUGINS':'basic-auth','KONG_NGINX_WORKER_PROCESSES':1,'KONG_PROXY_LISTEN':'0.0.0.0:8000','KONG_ADMIN_LISTEN':'off','KONG_PROXY_ACCESS_LOG':'/dev/null'},'volumes':['../.private/gateway.json:/private/gateway.json:ro'],'ports':['127.0.0.1:56581:8000']})
compose={'name':'trellis-alpha-proof','services':services,'networks':{'default':{'driver':'bridge','driver_opts':{'com.docker.network.bridge.enable_ip_masquerade':'false'}}},'volumes':{'trellis-data':{},'trellis-db-config':{}}}
(ROOT/'infra/compose.json').write_text(json.dumps(compose,indent=2)+'\n')
print('Prepared isolated Supabase profile. Credentials stay in .private/credentials.json.')
