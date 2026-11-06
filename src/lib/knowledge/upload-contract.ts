/** Shared browser/server contract. Document parsing is deterministic and never executes source content. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 200;
export const MAX_COLUMNS = 32;
// Retain bounded review headroom for introductory rows and owner exclusions.
// Only MAX_ROWS records may be saved; context rows are never a higher save limit.
export const MAX_REVIEW_ROWS = 250;
export const SPREADSHEET_FORMATS = ["csv", "xlsx"] as const;
export const GATEWAY_FORMATS = [...SPREADSHEET_FORMATS, "docx"] as const;
export const GATEWAY_ACCEPT = GATEWAY_FORMATS.map((format) => `.${format}`).join(",");
export const GATEWAY_FORMAT_LABEL = GATEWAY_FORMATS.map((format) => format.toUpperCase()).join(
  ", ",
);
export const UPLOAD_LIMIT_LABEL = `${MAX_FILE_BYTES / 1024 / 1024} MiB per file · ${MAX_ROWS} records · ${MAX_COLUMNS} spreadsheet columns`;
export function uploadIssue(file: Pick<File, "name" | "size">): string | undefined {
  if (!file.size || file.size > MAX_FILE_BYTES)
    return `Choose a non-empty source no larger than ${MAX_FILE_BYTES / 1024 / 1024} MiB.`;
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (!(GATEWAY_FORMATS as readonly string[]).includes(extension ?? ""))
    return `Choose ${GATEWAY_FORMAT_LABEL}. PDF, DOC, PowerPoint and image extraction are not supported.`;
}
