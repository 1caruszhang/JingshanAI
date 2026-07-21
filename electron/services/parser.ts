import {readFile} from 'node:fs/promises';
import {extname} from 'node:path';
import mammoth from 'mammoth';

// pdf-parse v1 tries to load test data at require time; disable it before import.
process.env.PDF_PARSE_DISABLE_TEST_DATA = '1';
import pdfParse from 'pdf-parse';

import * as XLSX from 'xlsx';

export interface ParseResult {
  text: string;
  title?: string;
  pageCount?: number;
}

function detectMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.doc':
      return 'application/msword';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.csv':
      return 'text/csv';
    case '.md':
    case '.markdown':
      return 'text/markdown';
    case '.txt':
    default:
      return 'text/plain';
  }
}

async function parseTxt(filePath: string): Promise<ParseResult> {
  const text = await readFile(filePath, 'utf-8');
  return {text};
}

async function parsePdf(filePath: string): Promise<ParseResult> {
  const buffer = await readFile(filePath);
  const data = await pdfParse(buffer);
  return {
    text: data.text,
    title: data.info?.Title,
    pageCount: data.numpages,
  };
}

async function parseDocx(filePath: string): Promise<ParseResult> {
  const buffer = await readFile(filePath);
  const result = await mammoth.extractRawText({buffer});
  return {text: result.value};
}

async function parseExcel(filePath: string): Promise<ParseResult> {
  const buffer = await readFile(filePath);
  const workbook = XLSX.read(buffer, {type: 'buffer'});
  const sheets: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    if (csv.trim()) {
      sheets.push(`## Sheet: ${sheetName}\n${csv}`);
    }
  }
  return {text: sheets.join('\n\n')};
}

export async function parseFile(filePath: string): Promise<ParseResult> {
  const mimeType = detectMimeType(filePath);
  switch (mimeType) {
    case 'application/pdf':
      return parsePdf(filePath);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return parseDocx(filePath);
    case 'application/msword':
      throw new Error('Legacy .doc format is not supported, please convert to .docx');
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.ms-excel':
    case 'text/csv':
      return parseExcel(filePath);
    case 'text/markdown':
    case 'text/plain':
    default:
      return parseTxt(filePath);
  }
}

export async function parseBuffer(
  buffer: Buffer,
  mimeType: string,
): Promise<ParseResult> {
  switch (mimeType) {
    case 'application/pdf':
      return pdfParse(buffer).then((data) => ({
        text: data.text,
        title: data.info?.Title,
        pageCount: data.numpages,
      }));
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return mammoth.extractRawText({buffer}).then((result) => ({text: result.value}));
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.ms-excel':
    case 'text/csv': {
      const workbook = XLSX.read(buffer, {type: 'buffer'});
      const sheets: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(worksheet);
        if (csv.trim()) {
          sheets.push(`## Sheet: ${sheetName}\n${csv}`);
        }
      }
      return {text: sheets.join('\n\n')};
    }
    case 'text/markdown':
    case 'text/plain':
    default:
      return {text: buffer.toString('utf-8')};
  }
}

export function getFileMimeType(filePath: string): string {
  return detectMimeType(filePath);
}
