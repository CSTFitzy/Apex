import { Router } from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { extractDocumentIntelligence } from '../utils/nlp.js';
import { matchDoctrineProfiles } from '../data/doctrine.js';
const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
        ];
        if (allowed.includes(file.mimetype) || /\.(pdf|docx|txt)$/i.test(file.originalname)) {
            cb(null, true);
        }
        else {
            cb(new Error('Unsupported file type. Please upload a PDF, DOCX or TXT file.'));
        }
    },
});
async function extractText(file) {
    const name = file.originalname.toLowerCase();
    if (name.endsWith('.pdf') || file.mimetype === 'application/pdf') {
        const parser = new PDFParse({ data: file.buffer });
        try {
            const result = await parser.getText();
            return result.text;
        }
        finally {
            await parser.destroy();
        }
    }
    if (name.endsWith('.docx') ||
        file.mimetype ===
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        return result.value;
    }
    // Plain text fallback
    return file.buffer.toString('utf-8');
}
/**
 * POST /api/documents/upload
 * Accepts a PDF, DOCX or TXT operational/fragmentary order, extracts text,
 * and runs rule-based NLP extraction to identify the operational area,
 * enemy/friendly force references, mission objectives, and matches the
 * findings against the simulated ODIN doctrine database for a first-pass
 * threat assessment.
 */
router.post('/upload', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No document uploaded (field name: document)' });
        }
        const text = await extractText(req.file);
        const extraction = extractDocumentIntelligence(text);
        const matchedDoctrine = matchDoctrineProfiles(text);
        res.json({
            filename: req.file.originalname,
            characterCount: text.length,
            extraction,
            matchedDoctrine,
            suggestedAO: extraction.coordinates.length > 0
                ? {
                    ...extraction.coordinates[0],
                    needsManualConfirmation: extraction.coordinates.length > 1,
                }
                : null,
            rawTextPreview: text.slice(0, 2000),
        });
    }
    catch (error) {
        console.error('Document processing failed:', error);
        const message = error instanceof Error ? error.message : 'Failed to process document';
        res.status(500).json({ error: message });
    }
});
export default router;
