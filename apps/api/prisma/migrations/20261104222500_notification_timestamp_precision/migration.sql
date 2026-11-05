ALTER TABLE "notifications"
ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3)
USING date_trunc(
  'milliseconds',
  "created_at" AT TIME ZONE 'UTC'
) AT TIME ZONE 'UTC';
