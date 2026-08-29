/**
 * Rule-based NLP extraction for operational/fragmentary orders text.
 * Extracts coordinates, enemy/friendly force references and mission
 * objectives using keyword and pattern matching (no external NLP service
 * required, keeping the feature usable offline / without API keys).
 */
// Matches decimal degree pairs, e.g. "34.0522, -118.2437" or "34.0522N 118.2437W"
const DECIMAL_COORD_REGEX = /(-?\d{1,3}\.\d+)\s*[°]?\s*([NnSs])?[,\s]+(-?\d{1,3}\.\d+)\s*[°]?\s*([EeWw])?/g;
// Matches Military Grid Reference System style tokens, e.g. "18TWL8401"
const MGRS_REGEX = /\b\d{1,2}[C-HJ-NP-X][A-HJ-NP-Z]{2}\d{2,10}\b/g;
const ENEMY_KEYWORDS = [
    'enemy',
    'opfor',
    'hostile',
    'adversary',
    'threat force',
    'insurgent',
    'red force',
];
const FRIENDLY_KEYWORDS = [
    'friendly',
    'blufor',
    'our forces',
    'own troops',
    'blue force',
    'friendly forces',
];
const OBJECTIVE_KEYWORDS = ['mission', 'objective', 'task', 'intent', 'end state'];
function toDecimal(value, hemisphere) {
    if (hemisphere && /[SsWw]/.test(hemisphere))
        return -Math.abs(value);
    return value;
}
function extractCoordinates(text) {
    const coords = [];
    let match;
    DECIMAL_COORD_REGEX.lastIndex = 0;
    while ((match = DECIMAL_COORD_REGEX.exec(text)) !== null) {
        const lat = toDecimal(parseFloat(match[1]), match[2]);
        const lon = toDecimal(parseFloat(match[3]), match[4]);
        if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
            coords.push({ lat, lon, raw: match[0].trim() });
        }
    }
    return coords;
}
function extractSentencesContaining(text, keywords) {
    const sentences = text
        .split(/(?<=[.!?\n])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
    const matches = sentences.filter((sentence) => {
        const lower = sentence.toLowerCase();
        return keywords.some((keyword) => lower.includes(keyword));
    });
    // De-duplicate while preserving order, cap output for readability
    return Array.from(new Set(matches)).slice(0, 15);
}
function extractKeyTerms(text) {
    const termPatterns = [
        /\bcompany\b/gi,
        /\bbattalion\b/gi,
        /\bbrigade\b/gi,
        /\bplatoon\b/gi,
        /\bsquad\b/gi,
        /\bregiment\b/gi,
        /\bmechanized\b/gi,
        /\barmou?red?\b/gi,
        /\bartillery\b/gi,
        /\bair defen[cs]e\b/gi,
        /\bMANPADS\b/gi,
        /\bIED\b/gi,
        /\bUAS\b|\bdrone\b/gi,
    ];
    const found = new Set();
    for (const pattern of termPatterns) {
        const matches = text.match(pattern);
        if (matches)
            matches.forEach((m) => found.add(m.toLowerCase()));
    }
    return Array.from(found);
}
export function extractDocumentIntelligence(text) {
    const mgrsMatches = Array.from(new Set(text.match(MGRS_REGEX) || []));
    const coordinates = extractCoordinates(text);
    return {
        coordinates,
        mgrsReferences: mgrsMatches,
        enemyMentions: extractSentencesContaining(text, ENEMY_KEYWORDS),
        friendlyMentions: extractSentencesContaining(text, FRIENDLY_KEYWORDS),
        objectives: extractSentencesContaining(text, OBJECTIVE_KEYWORDS),
        keyTerms: extractKeyTerms(text),
    };
}
