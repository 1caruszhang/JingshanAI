/**
 * #104: Asset file type detection.
 *
 * Pure helpers for deriving a human-facing file type from a knowledge entry's
 * source path. Used by the dashboard KbHealthPanel asset list and the
 * KbIngestPanel entries tab so both surfaces stay aligned.
 */

/** Coarse file-type bucket shown as a colored badge next to an asset. */
export type FileType = 'pdf' | 'image' | 'docx' | 'text';

/**
 * Detect the file-type bucket from a file path or name.
 *
 * Returns `undefined` for empty input, unknown extensions, or paths with no
 * extension — callers fall back to a generic label in that case.
 *
 * @example
 *   detectFileType('foo/bar.pdf')      // 'pdf'
 *   detectFileType('photo.webp')       // 'image'
 *   detectFileType('notes')            // undefined
 *   detectFileType('archive.zip')      // undefined
 */
export function detectFileType(filePath: string | null | undefined): FileType | undefined {
  if (!filePath) return undefined;
  const fileName = filePath.split(/[\\/]/).pop() ?? '';
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === fileName.length - 1) return undefined;
  const ext = fileName.slice(dotIndex + 1).toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'pdf';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
      return 'image';
    case 'docx':
    case 'doc':
      return 'docx';
    case 'txt':
    case 'md':
    case 'markdown':
      return 'text';
    default:
      return undefined;
  }
}

/** Extract the trailing file name from a path, returning `null` if absent. */
export function extractFileName(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const name = filePath.split(/[\\/]/).pop();
  return name && name.length > 0 ? name : null;
}
