/**
 * #104: Unit tests for asset file-type detection.
 *
 * Covers the acceptance criteria from issue #104:
 *  - each known extension maps to the right bucket
 *  - no extension → undefined
 *  - unknown extension → undefined
 *  - case-insensitive matching
 *  - null / empty / undefined inputs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { detectFileType, extractFileName } from '../fileType';

describe('detectFileType', () => {
  it('detects pdf', () => {
    assert.equal(detectFileType('foo/bar.pdf'), 'pdf');
    assert.equal(detectFileType('report.PDF'), 'pdf');
  });

  it('detects image variants (png/jpg/jpeg/webp)', () => {
    assert.equal(detectFileType('logo.png'), 'image');
    assert.equal(detectFileType('photo.jpg'), 'image');
    assert.equal(detectFileType('photo.JPEG'), 'image');
    assert.equal(detectFileType('hero.webp'), 'image');
  });

  it('detects docx and legacy doc', () => {
    assert.equal(detectFileType('brief.docx'), 'docx');
    assert.equal(detectFileType('old.doc'), 'docx');
  });

  it('detects text and markdown', () => {
    assert.equal(detectFileType('notes.txt'), 'text');
    assert.equal(detectFileType('README.md'), 'text');
    assert.equal(detectFileType('README.markdown'), 'text');
  });

  it('returns undefined for unknown extensions', () => {
    assert.equal(detectFileType('archive.zip'), undefined);
    assert.equal(detectFileType('data.csv'), undefined);
    assert.equal(detectFileType('sheet.xlsx'), undefined);
  });

  it('returns undefined when there is no extension', () => {
    assert.equal(detectFileType('notes'), undefined);
    assert.equal(detectFileType('path/to/Makefile'), undefined);
  });

  it('returns undefined for trailing-dot names', () => {
    assert.equal(detectFileType('weird.'), undefined);
  });

  it('returns undefined for null / undefined / empty input', () => {
    assert.equal(detectFileType(null), undefined);
    assert.equal(detectFileType(undefined), undefined);
    assert.equal(detectFileType(''), undefined);
  });

  it('handles Windows-style backslash paths', () => {
    assert.equal(detectFileType('C:\\docs\\report.pdf'), 'pdf');
    assert.equal(detectFileType('C:\\docs\\image.PNG'), 'image');
  });
});

describe('extractFileName', () => {
  it('extracts the trailing segment from unix paths', () => {
    assert.equal(extractFileName('a/b/c/report.pdf'), 'report.pdf');
  });

  it('extracts the trailing segment from windows paths', () => {
    assert.equal(extractFileName('C:\\docs\\report.pdf'), 'report.pdf');
  });

  it('returns the input when it is already a bare name', () => {
    assert.equal(extractFileName('report.pdf'), 'report.pdf');
  });

  it('returns null for null / undefined / empty input', () => {
    assert.equal(extractFileName(null), null);
    assert.equal(extractFileName(undefined), null);
    assert.equal(extractFileName(''), null);
  });
});
