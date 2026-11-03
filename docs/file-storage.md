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

Every new upload is written to the quarantine namespace before scanning. A clean
verdict promotes it to the active namespace. Infected objects are rejected and
removed. Scanner failures are recorded as unavailable, never as clean.

Production always requires scanning. `FILE_MALWARE_SCAN_REQUIRED=false` is rejected
in production, and a missing scanner configuration leaves the scanner unavailable:
uploads then fail with HTTP 503 unless it returns an explicit clean verdict. Local
development and tests may set it to `false`, in which case metadata is stored as
`UNSCANNED` and the UI labels it accordingly. Required-scan environments will not
download unscanned legacy objects.

The built-in HTTP scanner adapter uses `FILE_MALWARE_SCANNER_DRIVER=http` and sends
the validated file bytes in a POST request to `FILE_MALWARE_SCANNER_URL`. The
scanner must return JSON with exactly `{"status":"clean"}` or
`{"status":"infected"}`. Configure the optional bearer token and timeout with
`FILE_MALWARE_SCANNER_TOKEN` and `FILE_MALWARE_SCANNER_TIMEOUT_MS`. Use HTTPS in
production unless the scanner is a loopback sidecar.

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
default). Active objects are deleted only when no `file_attachments` row references
their generated key. The minimum age prevents cleanup from racing an upload between
object promotion and database commit. Quarantine objects older than the cutoff can
be removed because they are never downloadable or referenced as active content.
