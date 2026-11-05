# Local storage and malware-scanning services

The Compose stack includes PostgreSQL, RustFS (private S3-compatible storage),
and ClamAV. The PostgreSQL service and `nexus_postgres_data` volume are
unchanged. Starting or stopping the two new services does not recreate or stop
PostgreSQL.

## Configure credentials

Copy `.env.example` to `.env.local` for Compose and to `apps/api/.env` only if
that API file does not already exist. Replace the RustFS and AWS credential
placeholders in your local copies with unique development values; use the same
access/secret pair for `RUSTFS_*` and `AWS_*`. Do not reuse these local values
in production.

The `.env.local` file is Git-ignored. Specify it explicitly so Compose never
needs to read the repository's root `.env`; Compose does not read
`apps/api/.env`.

## Start and stop only the added services

From the repository root, start RustFS and ClamAV without starting, stopping, or
recreating PostgreSQL:

```powershell
docker compose --env-file .env.local --profile storage up -d rustfs clamav
docker compose --env-file .env.local --profile storage ps postgres rustfs clamav
```

Ports are bound to loopback only:

- RustFS S3 API: `http://127.0.0.1:9000` from the Windows host.
- RustFS management console: `http://127.0.0.1:9001`.
- ClamAV `clamd`: `127.0.0.1:3310`.

From another container attached to the Compose network, use
`http://rustfs:9000` for S3 and `clamav:3310` for clamd. Do not use
`localhost` from a container to reach a sibling service.

Check service health:

```powershell
docker inspect --format '{{.State.Health.Status}}' nexus-postgres
docker inspect --format '{{.State.Health.Status}}' nexus-rustfs
docker inspect --format '{{.State.Health.Status}}' nexus-clamav
curl.exe -fsS http://127.0.0.1:9000/health/ready
curl.exe -fsS http://127.0.0.1:9001/rustfs/console/health
docker compose --env-file .env.local --profile storage exec clamav clamdscan --ping=1
```

ClamAV downloads signatures during startup; its health check allows three
minutes. Allow at least 3–4 GiB of available memory for ClamAV and its
signature reloads.

Stop only the added services with:

```powershell
docker compose --env-file .env.local --profile storage stop rustfs clamav
```

The named volumes `nexus_rustfs_data` and `nexus_clamav_db` persist object data
and ClamAV signatures. Do not use `docker compose down -v` if you want to keep
any Compose data volumes.

## Create and verify a private bucket

RustFS does not make buckets public by default. Create the API bucket without
setting a public ACL or bucket policy. With AWS CLI v2 installed, run:

```powershell
$env:AWS_ACCESS_KEY_ID = '<same value as RUSTFS_ACCESS_KEY in .env.local>'
$env:AWS_SECRET_ACCESS_KEY = '<same value as RUSTFS_SECRET_KEY in .env.local>'
aws --endpoint-url http://127.0.0.1:9000 s3api create-bucket --bucket nexus-files --region us-east-1
aws --endpoint-url http://127.0.0.1:9000 s3api head-bucket --bucket nexus-files
```

An unauthenticated request to the bucket must be denied (HTTP 403):

```powershell
curl.exe -i http://127.0.0.1:9000/nexus-files/
```

The RustFS Console can also create the bucket. Keep the bucket private and do
not add anonymous/public-read policies. The root credentials are for local
administration; production should use separately scoped credentials and a
private bucket.

## Connect the API adapters

The API's S3 adapter uses the standard AWS credential variables, and its S3
configuration uses these values in `apps/api/.env`:

```dotenv
FILE_STORAGE_DRIVER=s3
FILE_S3_BUCKET=nexus-files
FILE_S3_REGION=us-east-1
FILE_S3_PREFIX=nexus
FILE_S3_ENDPOINT=http://127.0.0.1:9000
FILE_S3_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=<same value as RUSTFS_ACCESS_KEY>
AWS_SECRET_ACCESS_KEY=<same value as RUSTFS_SECRET_KEY>
```

The API requires real clamd scanning for uploads. Configure:

```dotenv
FILE_MALWARE_SCAN_REQUIRED=true
FILE_MALWARE_SCANNER_DRIVER=clamav
FILE_MALWARE_SCANNER_HOST=127.0.0.1
FILE_MALWARE_SCANNER_PORT=3310
FILE_MALWARE_SCANNER_TIMEOUT_MS=10000
```

For an API running in another Compose container, set the S3 endpoint to
`http://rustfs:9000` and the scanner host to `clamav`. `clamd` speaks its
INSTREAM TCP protocol; configure the `clamav` scanner driver rather than the
HTTP scanner driver. If ClamAV is unavailable or cannot return a clean/infected
verdict, required-scan uploads fail safely.

For an end-to-end signature check, create the standard EICAR test string in a
temporary file and run it through `clamdscan --stream` inside the ClamAV
container; ClamAV should report it as FOUND (exit code 1):

```powershell
docker compose --env-file .env.local --profile storage exec clamav sh -c 'printf "%s" "WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=" | base64 -d > /tmp/eicar.com; clamdscan --stream /tmp/eicar.com; result=$?; rm -f /tmp/eicar.com; test "$result" -eq 1'
```

EICAR is a harmless antivirus test pattern, not a live virus. Do not upload it
to a shared or production environment.
