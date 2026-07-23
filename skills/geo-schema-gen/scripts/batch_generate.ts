/**
 * Batch-generate schemas for multiple pages.
 *
 * Pure, deterministic logic: the caller supplies sitemap XML and fetched
 * page HTML; this module performs no network or filesystem I/O.
 * Migrated from geo_skills/geo-schema-gen/scripts/batch_generate.py.
 */

import {extractHtmlTitle, extractMetaContent} from './generate_schema.ts';

export type SchemaObject = Record<string, unknown>;

export interface PageInput {
  url: string;
  html: string;
}

export interface BatchResult {
  url: string;
  type: string;
  schema: SchemaObject;
}

export interface BatchSummary {
  total: number;
  successful: number;
  results: BatchResult[];
}

/** Extract page URLs from sitemap XML content. */
export function parseSitemapUrls(sitemapXml: string): string[] {
  const urls: string[] = [];
  const pattern = /<loc[^>]*>([\s\S]*?)<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sitemapXml)) !== null) {
    const url = match[1].trim();
    if (url) {
      urls.push(url);
    }
  }
  return urls;
}

/** Detect the best schema type for a page from its URL and HTML. */
export function detectPageType(url: string, html: string): string {
  const lowerUrl = url.toLowerCase();

  // Check for product indicators
  if (['/product', '/item', '/buy'].some((x) => lowerUrl.includes(x))) {
    return 'Product';
  }

  // Check for blog/article indicators
  if (['/blog/', '/article/', '/post/', '/news/'].some((x) => lowerUrl.includes(x))) {
    return 'BlogPosting';
  }

  // Check for FAQ indicators
  if (lowerUrl.includes('faq') || /<div[^>]+class=["'][^"']*faq[^"']*["'][^>]*>/i.test(html)) {
    return 'FAQPage';
  }

  // Check for about/organization
  if (['/about', '/company'].some((x) => lowerUrl.includes(x))) {
    return 'Organization';
  }

  // Check for contact/local business
  if (lowerUrl.includes('contact')) {
    return 'LocalBusiness';
  }

  // Default to Article for content pages
  if (/<article[\s>]/i.test(html) || /<h1[\s>]/i.test(html)) {
    return 'Article';
  }

  return 'WebPage';
}

/** Extract schema data of a given type from a fetched page. */
export function extractSchemaData(url: string, html: string, schemaType: string): SchemaObject {
  const data: SchemaObject = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    url,
  };

  if (schemaType === 'Article' || schemaType === 'BlogPosting') {
    const headline = extractHtmlTitle(html);
    if (headline) {
      data['headline'] = headline;
    }

    const description = extractMetaContent(html, ['description', 'og:description']);
    if (description) {
      data['description'] = description;
    }

    const author = extractMetaContent(html, ['author']);
    if (author) {
      data['author'] = {'@type': 'Person', name: author};
    }

    data['datePublished'] = new Date().toISOString().slice(0, 10);
  } else if (schemaType === 'Organization') {
    const title = extractHtmlTitle(html);
    data['name'] = title.split('-')[0].split('|')[0].trim();

    const description = extractMetaContent(html, ['description']);
    if (description) {
      data['description'] = description;
    }
  } else if (schemaType === 'Product') {
    const name = extractHtmlTitle(html);
    if (name) {
      data['name'] = name;
    }
  }

  return data;
}

/**
 * Generate schemas for a batch of already-fetched pages.
 *
 * Detects the page type and extracts schema data for each page.
 * Use `limit` to cap how many pages are processed.
 */
export function batchGenerateSchemas(pages: PageInput[], options: {limit?: number} = {}): BatchSummary {
  const limit = options.limit ?? 50;
  const selected = pages.slice(0, limit);

  const results: BatchResult[] = selected.map((page) => {
    const schemaType = detectPageType(page.url, page.html);
    const schema = extractSchemaData(page.url, page.html, schemaType);
    return {url: page.url, type: schemaType, schema};
  });

  return {
    total: selected.length,
    successful: results.length,
    results,
  };
}
