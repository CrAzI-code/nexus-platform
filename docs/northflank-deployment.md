# Northflank Developer Sandbox deployment

## Build configuration

Create two Northflank services from the same Git repository. Set the build
context to the repository root (`.`) for both services so npm can resolve the
workspace lockfile and package manifests.

| Service | Dockerfile | Container port |
| --- | --- | --- |
| Web | `apps/web/Dockerfile` | `3000` |
| API | `apps/api/Dockerfile` | `4000` |

The Dockerfiles use the production build stages by default. Keep the existing
root `.dockerignore`; it excludes local environment files, private uploads,
dependencies, and generated build output from the build context.

For the Web build, set `NEXT_PUBLIC_API_URL` to the public HTTPS API URL and
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` to the publishable key for the same Clerk
instance used by the API. These are public browser configuration, not secrets,
and are embedded in the web build. Never pass `CLERK_SECRET_KEY` as a build
argument or `NEXT_PUBLIC_*` variable.

## Runtime configuration

Put sensitive values in a Northflank secret group and inject them only at
runtime. Set `NODE_ENV=production` on both services. The web service also needs
`CLERK_SECRET_KEY` at runtime for Clerk server-side authentication.

Configure the API with:

- `PORT=4000`, `DATABASE_URL`, `WEB_ORIGIN`, `CLERK_SECRET_KEY`, and
  `CLERK_AUTHORIZED_PARTIES` (the exact public web origin).
- `FILE_STORAGE_DRIVER=s3`, `FILE_S3_BUCKET`, `FILE_S3_REGION`,
  `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` as runtime variables. Set
  `FILE_S3_ENDPOINT` and `FILE_S3_FORCE_PATH_STYLE=true` only when required by
  the S3-compatible provider. Keep the bucket private and use HTTPS for custom
  endpoints.
- `FILE_MALWARE_SCAN_REQUIRED=true`,
  `FILE_MALWARE_SCANNER_DRIVER=http`, and
  `FILE_MALWARE_SCANNER_URL=https://...`. The endpoint must accept a POST with
  the raw file bytes and return JSON `{"status":"clean"}` or
  `{"status":"infected"}`. Requests include the MIME type,
  `X-Nexus-Object-Key`, and URL-encoded `X-Nexus-Original-Name`; if required,
  configure `FILE_MALWARE_SCANNER_TOKEN` as a runtime secret. An unavailable
  or invalid scanner response fails closed; do not set scanning to false or
  use the `none` scanner for an upload-enabled deployment.
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, and `BREVO_SENDER_NAME` at runtime if
  transactional email is enabled.

Use the Northflank PostgreSQL add-on's private connection string for
`DATABASE_URL`. Apply Prisma migrations before routing traffic, using a
one-off job built from `apps/api/Dockerfile` with target `builder`, working
directory `/workspace/apps/api`, and command:

```text
npm exec -- prisma migrate deploy --schema prisma/schema.prisma
```

## Sandbox limits and service dependencies

Northflank currently lists the Sandbox as including two services, two jobs,
one database, and up to $20/month of Northflank Cloud resources. The Web and
API use both service slots; PostgreSQL uses the database allowance. The
production Compose deployment's RustFS and ClamAV containers cannot be added
as separate Sandbox services without exceeding the service count. Caddy is
also unnecessary for these two services because Northflank provides ingress
and TLS.

Use external private S3-compatible storage and a compatible HTTPS malware
scanner to retain production upload behavior without adding those containers.
If either dependency is not configured, do not enable uploads; the API requires
scanning and fails closed when it is unavailable. The Compose ClamAV allocation
is 4 GiB, which is not a fit for the Sandbox's small free resource allowance.

The $20/month resource allowance may also be insufficient for two always-on
application services plus PostgreSQL. Northflank's published smallest compute
plan is 0.5 vCPU / 1 GiB at $12/month, so two services at that size total $24
per month before database resources or storage. Confirm the current estimate
in the Northflank billing calculator before deployment; Sandbox quota and
resource allowances can change.

Source: [Northflank pricing and plan limits](https://northflank.com/pricing).
