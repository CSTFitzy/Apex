import { readFile } from 'fs/promises';
import { extname } from 'path';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

export function normalizeFileType(filename = '', mimeType = '') {
  const extension = extname(filename).toLowerCase();
  if (extension === '.pdf' || mimeType === 'application/pdf') return 'pdf';
  if (
    extension === '.docx' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (extension === '.txt' || mimeType.startsWith('text/')) return 'txt';
  if (IMAGE_EXTENSIONS.has(extension) || mimeType.startsWith('image/')) return extension.replace('.', '') || 'image';
  return 'unknown';
}

export function isAllowedDocumentType(filename, mimeType) {
  return ['pdf', 'docx', 'txt', 'jpg', 'jpeg', 'png'].includes(normalizeFileType(filename, mimeType));
}

export async function extractTextFromDocument(filePath, fileType) {
  if (fileType === 'txt') {
    return readFile(filePath, 'utf8');
  }

  if (fileType === 'docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  }

  if (fileType === 'pdf') {
    const buffer = await readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text || '';
    } finally {
      await parser.destroy();
    }
  }

  return '';
}

export function buildPreview(extractedText = '', fileType = 'unknown') {
  const text = (extractedText || '').trim();
  if (text) {
    return {
      type: 'text',
      text: text.slice(0, 500),
      truncated: text.length > 500,
    };
  }

  return {
    type: fileType === 'pdf' ? 'pdf' : fileType === 'jpg' || fileType === 'jpeg' || fileType === 'png' ? 'image' : 'empty',
    text: '',
    truncated: false,
  };
}
