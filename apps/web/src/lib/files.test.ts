import { describe, expect, it } from "vitest";
import { formatFileDate, formatFileSize, formatFileType } from "./files";

describe("file presentation helpers", () => {
  it("formats file sizes using readable units", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1024)).toMatch(/1(\.0)? KB/u);
    expect(formatFileSize(1_048_576)).toMatch(/1(\.0)? MB/u);
    expect(formatFileSize(Number.NaN)).toBe("Unknown size");
  });

  it("formats valid upload times and handles invalid timestamps", () => {
    expect(formatFileDate("2026-11-02T18:00:00.000Z")).not.toBe("Unknown date");
    expect(formatFileDate("not-a-date")).toBe("Unknown date");
  });

  it("uses readable labels for supported file types", () => {
    expect(formatFileType("application/pdf")).toBe("PDF");
    expect(formatFileType("image/webp")).toBe("WebP image");
    expect(formatFileType("text/csv")).toBe("CSV");
    expect(formatFileType("application/unknown")).toBe("File");
  });
});
