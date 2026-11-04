import "server-only";
import { Unzip, UnzipInflate } from "fflate";
export function readOfficeArchive(bytes: Uint8Array) {
  const entries: Record<string, Uint8Array> = Object.create(null);
  const names = new Set<string>();
  let expanded = 0,
    completed = 0;
  const unzip = new Unzip((entry) => {
    if (
      names.has(entry.name) ||
      names.size >= 128 ||
      ![0, 8].includes(entry.compression) ||
      /\.\.|^\/|\\|vba|embeddings|externalLinks|activeX|ctrlProps/iu.test(entry.name)
    )
      throw new Error("Workbook structure is unsafe or too large.");
    names.add(entry.name);
    const parts: Uint8Array[] = [];
    let size = 0;
    entry.ondata = (error, data, final) => {
      if (error) throw error;
      size += data.length;
      expanded += data.length;
      if (size > 4 * 1024 * 1024 || expanded > 8 * 1024 * 1024)
        throw new Error("Workbook expansion is unsafe or too large.");
      parts.push(data);
      if (final) {
        const value = new Uint8Array(size);
        let offset = 0;
        for (const part of parts) {
          value.set(part, offset);
          offset += part.length;
        }
        entries[entry.name] = value;
        completed++;
      }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  // Incremental inflation bounds real output, even when ZIP size metadata lies.
  for (let offset = 0; offset < bytes.length; offset += 256)
    unzip.push(bytes.subarray(offset, offset + 256), offset + 256 >= bytes.length);
  if (completed !== names.size) throw new Error("The workbook archive is incomplete.");
  return entries;
}
