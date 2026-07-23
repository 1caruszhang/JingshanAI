/**
 * Smoke test: import and call each migrated geo skill TS script (Issue #25).
 * Run with: npx tsx scripts/smoke-geo-skills.ts
 * Manual verification aid — proves the scripts import and run in Node.js.
 */
import {analyzeContent, formatAnalysisMarkdown} from '../skills/geo-content-optimizer/scripts/analyze_content.ts';
import {optimizeContent, generateChangelog} from '../skills/geo-content-optimizer/scripts/optimize_content.ts';
import {extractCandidateClaims} from '../skills/geo-fact-checker/scripts/claim_extractor.ts';
import {structureContent} from '../skills/geo-structured-writer/scripts/structure_content.ts';
import {generateContent} from '../skills/geo-citation-writer/scripts/generate_content.ts';
import {generateSchemaFromData, SUPPORTED_SCHEMA_TYPES} from '../skills/geo-schema-gen/scripts/generate_schema.ts';
import {validateSchema} from '../skills/geo-schema-gen/scripts/validate_schema.ts';
import {batchGenerateSchemas, detectPageType} from '../skills/geo-schema-gen/scripts/batch_generate.ts';
import {auditSentiment} from '../skills/geo-sentiment-optimizer/scripts/audit_sentiment.ts';
import {exportLocationPageOutline} from '../skills/geo-local-optimizer/scripts/generate_local_page_outline.ts';
import {buildExampleTerminologyMap, toMarkdownTable} from '../skills/geo-multilingual-optimizer/scripts/multilingual_terminology_helper.ts';

const sample = `# RAG Overview

Retrieval-Augmented Generation is a technique that combines retrieval with generation. According to a 2024 study, RAG improves accuracy by 40%.

## How it works

RAG retrieves documents first. Pinecone is the market leader with 35% market share.

- Step one
- Step two
- Step three
`;

let ok = 0;
function check(label: string, fn: () => void) {
  try { fn(); ok++; console.log(`  ✓ ${label}`); }
  catch (err) { console.error(`  ✗ ${label}: ${(err as Error).message}`); process.exitCode = 1; }
}

check('geo-content-optimizer/analyzeContent', () => {
  const r = analyzeContent(sample);
  if (typeof r.percentage !== 'number' || !r.grade) throw new Error('bad report shape');
  if (!formatAnalysisMarkdown(r).includes('GEO Content Analysis')) throw new Error('bad markdown');
});

check('geo-content-optimizer/optimizeContent', () => {
  const r = optimizeContent(sample, 'article');
  if (typeof r.optimized !== 'string') throw new Error('missing optimized content');
  if (r.changes.length === 0) throw new Error('no recommendations produced');
  if (!generateChangelog(r.changes).includes('# Optimization Changelog')) throw new Error('bad changelog');
});

check('geo-fact-checker/extractCandidateClaims', () => {
  const claims = extractCandidateClaims(sample);
  if (!Array.isArray(claims) || claims.length === 0) throw new Error('no claims extracted');
  if (!claims[0].claimType || !claims[0].text) throw new Error('bad claim shape');
});

check('geo-structured-writer/structureContent', () => {
  const out = structureContent(sample);
  if (!out.includes('Frequently Asked Questions')) throw new Error('FAQ block not appended');
});

check('geo-citation-writer/generateContent', () => {
  const r = generateContent({format: 'definition', topic: 'RAG'});
  if (!r.content.includes('RAG')) throw new Error('topic not substituted');
});

check('geo-schema-gen/generateSchemaFromData', () => {
  const schema = generateSchemaFromData({
    type: 'Organization',
    name: 'Acme Corp',
    url: 'https://acme.example',
  });
  if (!schema || schema['@type'] !== 'Organization') throw new Error('bad schema');
  if (!SUPPORTED_SCHEMA_TYPES.includes('FAQPage')) throw new Error('FAQPage unsupported');
});

check('geo-schema-gen/validateSchema', () => {
  const r = validateSchema({'@context': 'https://schema.org', '@type': 'Organization', name: 'Acme'});
  if (typeof r.valid !== 'boolean') throw new Error('bad validation result');
});

check('geo-schema-gen/batchGenerateSchemas', () => {
  const r = batchGenerateSchemas([
    {url: 'https://acme.example/faq', html: '<title>FAQ</title>'},
  ]);
  if (!r || typeof r !== 'object') throw new Error('bad batch result');
  if (detectPageType('https://x.example/faq', '') !== 'FAQPage') throw new Error('detectPageType broken');
});

check('geo-sentiment-optimizer/auditSentiment', () => {
  const r = auditSentiment(sample);
  if (typeof r !== 'object' || r === null) throw new Error('bad audit result');
});

check('geo-local-optimizer/exportLocationPageOutline', () => {
  const sections = exportLocationPageOutline();
  if (!Array.isArray(sections) || sections.length === 0) throw new Error('empty outline');
});

check('geo-multilingual-optimizer/buildExampleTerminologyMap', () => {
  const map = buildExampleTerminologyMap();
  const md = toMarkdownTable(map);
  if (!md.includes('|')) throw new Error('bad markdown table');
});

console.log(`\n${ok}/11 smoke checks passed`);
