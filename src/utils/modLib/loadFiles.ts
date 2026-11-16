/**
 * Getting bundle text (and its art) into the page.
 *
 * Everything runs in the browser's own file APIs, so the same code works on
 * GitHub Pages, in the Vite dev server and inside the Tauri webview: a folder
 * picker (`webkitdirectory`) yields every file with its path, and a dropped or
 * chosen `.zip` is read with the JSZip the exporter already depends on.
 *
 * Only `.lua` / `.toml` / `.wep` are read eagerly. PNG / GIF / WAV entries are
 * listed with a lazy reader: an installed `Mods/` tree can hold hundreds of
 * megabytes of art, and an import only needs the sheets its own weapon names.
 * `bytesOf` reads one on demand from the picked file or the ZIP entry.
 *
 * A native path read (`@tauri-apps/plugin-fs`) would avoid the extra click, but
 * that package is not a dependency yet; the folder picker opens Tauri's native
 * dialog too, so the flow is identical either way.
 */
import JSZip from 'jszip';
import type { ModFile } from './scan';

const TEXT_FILE = /\.(lua|toml)$/i;
/** A bundled `.wep` is the weapon's base record, so it is read as bytes. */
const BINARY_FILE = /\.wep$/i;
/** Art and sounds the importer can attach back to a project. */
const ASSET_FILE = /\.(png|gif|wav)$/i;

function pathOf(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return relative && relative.length > 0 ? relative : file.name;
}

/** Files worth reading out of a picker's selection. */
export function textFilesOf(list: FileList | File[] | null): File[] {
  if (!list) return [];
  return Array.from(list).filter(
    (file) => TEXT_FILE.test(file.name) || BINARY_FILE.test(file.name) || ASSET_FILE.test(file.name),
  );
}

/** The bytes of an entry the importer needs, whichever source it came from. */
export async function bytesOf(file: ModFile): Promise<Uint8Array | undefined> {
  if (file.bytes) return file.bytes;
  if (file.readBytes) return file.readBytes();
  if (file.file) return new Uint8Array(await file.file.arrayBuffer());
  return undefined;
}

export async function readFileTexts(list: FileList | File[] | null): Promise<ModFile[]> {
  const files = textFilesOf(list);
  const out: ModFile[] = [];
  for (const file of files) {
    const path = pathOf(file).split('\\').join('/');
    if (BINARY_FILE.test(file.name)) {
      out.push({ path, text: '', bytes: new Uint8Array(await file.arrayBuffer()) });
    } else if (ASSET_FILE.test(file.name)) {
      out.push({ path, text: '', file });
    } else {
      out.push({ path, text: await file.text() });
    }
  }
  return out;
}

/**
 * What one dropped `.zip` may cost the tab. An installed `Mods/` tree is a few
 * megabytes of Lua and a lot of art; a zip bomb is a few kilobytes expanding to
 * gigabytes, and text entries are decompressed eagerly before the reader can say
 * no. The cap is generous for a real pack and the refusal names the limit
 * instead of leaving the tab to die.
 */
export const ZIP_LIMITS = { entries: 4096, textBytes: 48 * 1024 * 1024 };

const tooBig = (name: string, what: string) =>
  new Error(`${name} ${what}, more than an import reads.`);

export async function readZipTexts(file: File): Promise<ModFile[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.entries(zip.files).filter(([, entry]) => !entry.dir);
  if (entries.length > ZIP_LIMITS.entries) {
    throw tooBig(file.name, `holds ${entries.length} files (limit ${ZIP_LIMITS.entries})`);
  }
  const out: ModFile[] = [];
  let read = 0;
  const account = (bytes: number) => {
    read += bytes;
    if (read > ZIP_LIMITS.textBytes) {
      throw tooBig(
        file.name,
        `expands past ${Math.round(ZIP_LIMITS.textBytes / (1024 * 1024))} MiB of Lua and records`,
      );
    }
  };
  for (const [name, entry] of entries) {
    const path = name.split('\\').join('/');
    if (TEXT_FILE.test(name)) {
      const text = await entry.async('string');
      account(text.length);
      out.push({ path, text });
    } else if (BINARY_FILE.test(name)) {
      const bytes = await entry.async('uint8array');
      account(bytes.length);
      out.push({ path, text: '', bytes });
    } else if (ASSET_FILE.test(name)) {
      // Art stays lazy: an import only needs the sheets its own weapon names.
      out.push({ path, text: '', readBytes: () => entry.async('uint8array') });
    }
  }
  return out;
}

/** A dropped item can be a zip or a folder; both end up as `ModFile[]`. */
export async function readDroppedItems(items: DataTransferItemList): Promise<ModFile[]> {
  const out: ModFile[] = [];

  const walkEntry = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) =>
        (entry as FileSystemFileEntry).file(resolve, () => resolve(null)),
      );
      if (!file) return;
      if (/\.zip$/i.test(file.name)) {
        out.push(...(await readZipTexts(file)));
        return;
      }
      const path = entry.fullPath.replace(/^\//, '');
      if (BINARY_FILE.test(file.name)) {
        out.push({ path, text: '', bytes: new Uint8Array(await file.arrayBuffer()) });
        return;
      }
      if (ASSET_FILE.test(file.name)) {
        out.push({ path, text: '', file });
        return;
      }
      if (!TEXT_FILE.test(file.name)) return;
      out.push({ path, text: await file.text() });
      return;
    }
    if (!entry.isDirectory) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) =>
        reader.readEntries(resolve, () => resolve([])),
      );
      if (batch.length === 0) break;
      for (const child of batch) await walkEntry(child);
    }
  };

  for (const item of Array.from(items)) {
    // `getAsEntry` is only valid while the drop event is being handled, so it
    // has to be called before any `await`.
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      await walkEntry(entry);
      continue;
    }
    const file = item.getAsFile();
    if (!file) continue;
    if (/\.zip$/i.test(file.name)) out.push(...(await readZipTexts(file)));
    else if (BINARY_FILE.test(file.name)) {
      out.push({ path: file.name, text: '', bytes: new Uint8Array(await file.arrayBuffer()) });
    } else if (ASSET_FILE.test(file.name)) {
      out.push({ path: file.name, text: '', file });
    } else if (TEXT_FILE.test(file.name)) out.push({ path: file.name, text: await file.text() });
  }

  return out;
}
