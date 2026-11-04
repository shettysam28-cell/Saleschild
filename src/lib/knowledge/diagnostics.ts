export type ImportDiagnostic = {
  code: string;
  message: string;
  worksheet?: string;
  row?: number;
  column?: string;
  worksheets?: string[];
};
export class ImportError extends Error {
  constructor(public diagnostic: ImportDiagnostic) {
    super(diagnostic.message);
  }
}
export function diagnostic(error: unknown): ImportDiagnostic {
  return error instanceof ImportError
    ? error.diagnostic
    : {
        code: "READ_FAILED",
        message:
          "This file could not be parsed. Save a fresh XLSX or UTF-8 CSV copy and upload again.",
      };
}
export function fail(
  code: string,
  message: string,
  location: Partial<ImportDiagnostic> = {},
): never {
  throw new ImportError({ code, message, ...location });
}
