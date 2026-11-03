-- Preserve whether file content was positively verified by a malware scanner.
-- Existing objects remain explicitly unscanned until a future rescan workflow
-- marks them clean; no existing file is misrepresented as scanned.
CREATE TYPE "FileScanStatus" AS ENUM ('CLEAN', 'UNSCANNED');

ALTER TABLE "file_attachments"
ADD COLUMN "scan_status" "FileScanStatus" NOT NULL DEFAULT 'UNSCANNED';
