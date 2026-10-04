export const PROFILE_VERSION = 'supabase-local/v1alpha1';
export const IMAGES = {
  db: 'public.ecr.aws/supabase/postgres@sha256:6942962433a569e87f228b4d4ab7e11db5deca64e43babb3a038443ad6c4f1bb',
  meta: 'public.ecr.aws/supabase/postgres-meta@sha256:9a079ac1c94d89629262822a4bd1902d5b1be4adb464e5a0a8fd078aaed72158',
  studio: 'public.ecr.aws/supabase/studio@sha256:4905784b715cb22b265d26405067649544b40faffff89fd8dc7a28736f42afb0',
  rest: 'public.ecr.aws/supabase/postgrest@sha256:85258123312dc496ad4c2ed832154a65e9746f84df0d6d09b44229ff9230c08e',
  gateway: 'public.ecr.aws/supabase/kong@sha256:1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d',
} as const;
export const CREDENTIAL_KEYS = ['POSTGRES_PASSWORD', 'JWT_SECRET', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'PG_META_CRYPTO_KEY', 'DASHBOARD_USERNAME', 'DASHBOARD_PASSWORD'] as const;
export type Credentials = Record<typeof CREDENTIAL_KEYS[number], string>;
export interface ProfileInput { project: string; databasePort: number; studioPort: number; revision: string }
export function composeProfile(input: ProfileInput): object {
  const labels = { 'io.bowerloom.local-backend': input.project, 'io.bowerloom.plan-revision': input.revision };
  const base = (service: keyof typeof IMAGES, memory: string) => ({ image: IMAGES[service], pull_policy: 'never', restart: 'unless-stopped', mem_limit: memory, cpus: 1, labels,
    logging: { driver: 'json-file', options: { 'max-size': '5m', 'max-file': '2' } } });
  const healthy = { db: { condition: 'service_healthy' } };
  return { name: input.project, services: {
    db: { ...base('db', '384m'), environment: { POSTGRES_HOST: '/var/run/postgresql', PGPORT: 5432, POSTGRES_PORT: 5432, POSTGRES_DB: 'postgres', PGDATABASE: 'postgres', POSTGRES_PASSWORD: '${POSTGRES_PASSWORD:?}', PGPASSWORD: '${POSTGRES_PASSWORD:?}', JWT_EXP: 3600 },
      ports: [`127.0.0.1:${input.databasePort}:5432`], volumes: ['data:/var/lib/postgresql/data', 'db-config:/etc/postgresql-custom', './roles.sql:/docker-entrypoint-initdb.d/init-scripts/99-roles.sql:ro', './jwt.sql:/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql:ro'],
      command: ['postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf', '-c', 'shared_buffers=64MB', '-c', 'max_connections=50'],
      healthcheck: { test: ['CMD', 'pg_isready', '-U', 'postgres', '-h', 'localhost'], interval: '2s', timeout: '2s', retries: 45 } },
    meta: { ...base('meta', '192m'), depends_on: healthy, environment: { PG_META_PORT: 8080, PG_META_DB_HOST: 'db', PG_META_DB_PORT: 5432, PG_META_DB_NAME: 'postgres', PG_META_DB_USER: 'postgres', PG_META_DB_PASSWORD: '${POSTGRES_PASSWORD:?}', CRYPTO_KEY: '${PG_META_CRYPTO_KEY:?}' } },
    studio: { ...base('studio', '512m'), depends_on: { meta: { condition: 'service_started' } }, environment: {
      HOSTNAME: '0.0.0.0', STUDIO_PG_META_URL: 'http://meta:8080', POSTGRES_HOST: 'db', POSTGRES_PORT: 5432, POSTGRES_DB: 'postgres', POSTGRES_PASSWORD: '${POSTGRES_PASSWORD:?}', POSTGRES_USER_READ_WRITE: 'postgres', PG_META_CRYPTO_KEY: '${PG_META_CRYPTO_KEY:?}', PGRST_DB_SCHEMAS: 'public',
      DEFAULT_ORGANIZATION_NAME: 'Bowerloom Local', DEFAULT_PROJECT_NAME: input.project, SUPABASE_URL: 'http://gateway:8000', SUPABASE_PUBLIC_URL: `http://127.0.0.1:${input.studioPort}`, SUPABASE_ANON_KEY: '${ANON_KEY:?}', SUPABASE_SERVICE_KEY: '${SERVICE_ROLE_KEY:?}', AUTH_JWT_SECRET: '${JWT_SECRET:?}', OPENAI_API_KEY: '', NEXT_PUBLIC_ENABLE_LOGS: 'false', ENABLED_FEATURES_LOGS_ALL: 'false', NEXT_PUBLIC_IS_PLATFORM: 'false' },
      healthcheck: { test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:3000/api/platform/profile').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"], interval: '5s', timeout: '3s', retries: 30 } },
    rest: { ...base('rest', '96m'), depends_on: healthy, environment: { PGRST_DB_URI: 'postgres://authenticator:${POSTGRES_PASSWORD:?}@db:5432/postgres', PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: '${JWT_SECRET:?}', PGRST_DB_USE_LEGACY_GUCS: 'false', PGRST_APP_SETTINGS_JWT_SECRET: '${JWT_SECRET:?}', PGRST_APP_SETTINGS_JWT_EXP: 3600 } },
    gateway: { ...base('gateway', '192m'), depends_on: { studio: { condition: 'service_healthy' } }, environment: { KONG_DATABASE: 'off', KONG_DECLARATIVE_CONFIG: '/private/gateway.json', KONG_DNS_ORDER: 'LAST,A,CNAME', KONG_PLUGINS: 'basic-auth', KONG_NGINX_WORKER_PROCESSES: 1, KONG_PROXY_LISTEN: '0.0.0.0:8000', KONG_ADMIN_LISTEN: 'off', KONG_PROXY_ACCESS_LOG: '/dev/null' }, volumes: ['./gateway.json:/private/gateway.json:ro'], ports: [`127.0.0.1:${input.studioPort}:8000`] },
  }, networks: { default: { driver: 'bridge', driver_opts: { 'com.docker.network.bridge.enable_ip_masquerade': 'false' }, labels } }, volumes: { data: { labels }, 'db-config': { labels } } };
}
export function gatewayProfile(credentials: Credentials): object {
  return { _format_version: '2.1', _transform: true, consumers: [{ username: credentials.DASHBOARD_USERNAME, basicauth_credentials: [{ username: credentials.DASHBOARD_USERNAME, password: credentials.DASHBOARD_PASSWORD }] }], services: [
    { name: 'studio', url: 'http://studio:3000/', routes: [{ name: 'studio', paths: ['/'], strip_path: false }], plugins: [{ name: 'basic-auth', config: { hide_credentials: true } }] },
    { name: 'rest', url: 'http://rest:3000/', routes: [{ name: 'rest', paths: ['/rest/v1/'], strip_path: true }] },
  ] };
}
// Derived from the existing reviewed proof. Substitutions use only generated lowercase hex credentials.
export function rolesSql(password: string): string {
  return ['authenticator', 'pgbouncer', 'supabase_auth_admin', 'supabase_functions_admin', 'supabase_storage_admin'].map(role => `ALTER USER ${role} WITH PASSWORD '${password}';`).join('\n') + '\n';
}
export const JWT_SQL = "ALTER DATABASE postgres SET \"app.settings.jwt_exp\" TO '3600';\n";
