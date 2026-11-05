# Private file storage

NEXUS stores file metadata in PostgreSQL and private file bytes behind the API.
Clients never receive bucket URLs or choose object keys. The API generates a UUID,
performs organization/project authorization, and streams authorized downloads.

## Storage drivers

`FILE_STORAGE_DRIVER=local` is the development and test default. Objects are kept
under `apps/api/private-files` (or `FILE_STORAGE_PATH`) in separate `quarantine`
and `active` directories. The directory must remain outside `apps/web/public`.

Production must explicitly use `FILE_STORAGE_DRIVER=s3`. Configure:

- `FILE_S3_BUCKET`: a private bucket with public access blocked.
- `FILE_S3_REGION`: the provider region.
- `FILE_S3_PREFIX`: optional private key prefix; defaults to `nexus`.
- `FILE_S3_ENDPOINT`: optional HTTPS endpoint for an S3-compatible provider.
- `FILE_S3_FORCE_PATH_STYLE`: use only when required by the provider.
- Standard AWS SDK credentials (`AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, and optional `AWS_SESSION_TOKEN`) or another standard
  SDK credential source such as an instance/task role.

The adapter does not set a public ACL or produce public/presigned URLs. The API
process needs only object read, write, copy, list, head, and delete permissions
within the configured prefix.

## Malware scanning and quarantine

Every new upload is written to the quarantine namespace before scanning. Only an
explicit clean verdict promotes it to the active namespace and creates
downloadable metadata. Infected content is rejected; scanner errors or missing
scanner configuration fail the upload with HTTP 503 and do not promote the
object. `FILE_MALWARE_SCAN_REQUIRED` must be `true` in every environment;
`false` is rejected. Legacy `UNSCANNED` metadata remains labeled as unverified
and cannot be previewed or downloaded.

The `clamav` scanner driver sends validated file bytes to clamd using its
INSTREAM TCP protocol. Configure `FILE_MALWARE_SCANNER_HOST`,
`FILE_MALWARE_SCANNER_PORT` (default `3310`), and
`FILE_MALWARE_SCANNER_TIMEOUT_MS`. The local default is required and uses
ClamAV. For the local Compose service, use
`127.0.0.1` from a host API or `clamav` from another Compose container. Clamd's
TCP protocol is unauthenticated, so keep its port restricted to trusted
networks.

The HTTP scanner adapter remains available with
`FILE_MALWARE_SCANNER_DRIVER=http`; it POSTs validated file bytes to
`FILE_MALWARE_SCANNER_URL`. The scanner must return JSON with exactly
`{"status":"clean"}` or `{"status":"infected"}`. Configure the optional bearer
token and timeout with `FILE_MALWARE_SCANNER_TOKEN` and
`FILE_MALWARE_SCANNER_TIMEOUT_MS`. Use HTTPS in production unless the scanner
is a loopback sidecar.

## Orphan cleanup

Build the API, then run a dry run:

```powershell
npm.cmd run build --workspace apps/api
npm.cmd run files:cleanup --workspace apps/api
```

Apply the reported cleanup with:

```powershell
npm.cmd run files:cleanup --workspace apps/api -- --apply
```

Cleanup only considers objects older than `FILE_ORPHAN_MIN_AGE_SECONDS` (one day by
default). Active database records are never deleted. Objects belonging to soft-
removed records become eligible only after both the record removal and object age
pass the cutoff; unreferenced objects use the object-age cutoff. Failed API deletes
keep their soft-removed metadata and can be retried by repeating the removal request
or rerunning cleanup after retention. Cleanup errors are surfaced and can be retried
by rerunning the command. The minimum age prevents cleanup from racing an upload
between object promotion and database commit.

## Real-service file integration tests

The opt-in file-storage e2e suite uses PostgreSQL, the configured private S3
provider, and ClamAV; it never loads `.env` files. It refuses to connect unless
the database URL points to loopback PostgreSQL database `nexus_file_e2e`.
Create that dedicated test database and apply migrations before running the
suite; do not point it at the normal `nexus` development database.

Supply these variables directly in the test process or through a dedicated,
ignored test environment file that is not either application `.env`:

- `NEXUS_FILE_STORAGE_E2E=true`
- `NEXUS_FILE_E2E_DATABASE_URL`: loopback URL ending in `/nexus_file_e2e`
- `FILE_STORAGE_DRIVER=s3`, `FILE_S3_BUCKET`, `FILE_S3_REGION`,
  `FILE_S3_ENDPOINT`, and `FILE_S3_FORCE_PATH_STYLE=true`
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` for the private test bucket
- `FILE_MALWARE_SCAN_REQUIRED=true`, `FILE_MALWARE_SCANNER_DRIVER=clamav`,
  `FILE_MALWARE_SCANNER_HOST=127.0.0.1`, and
  `FILE_MALWARE_SCANNER_PORT=3310`

Run only the suite after the test database has migrations:

```powershell
npm run test:e2e --workspace apps/api -- src/files/files-storage.e2e-spec.ts
```

The suite generates unique tenant records and an S3 key prefix per run, checks
service credentials with a private-object readiness probe, and removes only its
own metadata and objects. Clerk token verification is stubbed at the auth
service boundary; the real guard, controllers, authorization service logic,
database, S3 adapter, and ClamAV scanner remain in the request path. A transient
storage deletion failure is injected once to verify API retry behavior; the
retry itself removes the object through RustFS.
