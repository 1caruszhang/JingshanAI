/**
 * Generate Schema.org JSON-LD markup.
 *
 * Pure, deterministic generation logic (no CLI, no network).
 * Migrated from geo_skills/geo-schema-gen/scripts/generate_schema.py.
 */

export type SchemaObject = Record<string, unknown>;

export const SCHEMA_TEMPLATES: Record<string, SchemaObject> = {
  Organization: {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: '',
    url: '',
    logo: '',
    description: '',
    sameAs: [],
  },
  WebSite: {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: '',
    url: '',
    potentialAction: {
      '@type': 'SearchAction',
      target: '',
      'query-input': 'required name=search_term_string',
    },
  },
  Article: {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: '',
    description: '',
    author: {
      '@type': 'Person',
      name: '',
    },
    publisher: {
      '@type': 'Organization',
      name: '',
      logo: {
        '@type': 'ImageObject',
        url: '',
      },
    },
    datePublished: '',
    dateModified: '',
    url: '',
  },
  BlogPosting: {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: '',
    description: '',
    author: {
      '@type': 'Person',
      name: '',
    },
    publisher: {
      '@type': 'Organization',
      name: '',
      logo: {
        '@type': 'ImageObject',
        url: '',
      },
    },
    datePublished: '',
    dateModified: '',
    url: '',
  },
  FAQPage: {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [],
  },
  Product: {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: '',
    description: '',
    brand: {
      '@type': 'Brand',
      name: '',
    },
    offers: {
      '@type': 'Offer',
      price: '',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    },
  },
  HowTo: {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: '',
    description: '',
    totalTime: '',
    step: [],
  },
  BreadcrumbList: {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [],
  },
  VideoObject: {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: '',
    description: '',
    thumbnailUrl: '',
    uploadDate: '',
    duration: '',
  },
  LocalBusiness: {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: '',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '',
      addressLocality: '',
      addressRegion: '',
      postalCode: '',
      addressCountry: '',
    },
    telephone: '',
    openingHours: '',
  },
};

export const SUPPORTED_SCHEMA_TYPES: string[] = Object.keys(SCHEMA_TEMPLATES);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep merge `overlay` into `base` (mutates and returns `base`).
 * Nested plain objects are merged recursively; all other values are overwritten.
 */
export function deepMerge(base: SchemaObject, overlay: SchemaObject): SchemaObject {
  for (const [key, value] of Object.entries(overlay)) {
    const existing = base[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      deepMerge(existing, value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

function cloneTemplate(schemaType: string): SchemaObject | null {
  const template = SCHEMA_TEMPLATES[schemaType];
  if (!template) {
    return null;
  }
  return JSON.parse(JSON.stringify(template)) as SchemaObject;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Generate a schema from structured input data.
 *
 * The input must specify the schema type via `@type` or `type`.
 * If the type has a known template, the input is deep-merged over the
 * template; otherwise the input is returned as-is.
 * Returns null when no schema type is specified.
 */
export function generateSchemaFromData(data: SchemaObject): SchemaObject | null {
  const schemaType = (data['@type'] ?? data['type']) as string | undefined;
  if (!schemaType) {
    return null;
  }

  const template = cloneTemplate(schemaType);
  if (!template) {
    // Use input data as-is if type not in templates
    return data;
  }

  return deepMerge(template, data);
}

/** Extract the text of the first <h1>, falling back to <title>. */
export function extractHtmlTitle(html: string): string {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const raw = h1?.[1] ?? title?.[1] ?? '';
  return raw.replace(/<[^>]+>/g, '').trim();
}

/** Extract the `content` of a <meta> tag matched by name or property. */
export function extractMetaContent(html: string, keys: string[]): string {
  for (const key of keys) {
    const pattern = new RegExp(
      `<meta[^>]+(?:name|property)=["']${key}["'][^>]+content=["']([^"']*)["']`,
      'i',
    );
    const match = pattern.exec(html);
    if (match) {
      return match[1].trim();
    }
    // attribute order may be reversed (content before name)
    const reversed = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${key}["']`,
      'i',
    );
    const reversedMatch = reversed.exec(html);
    if (reversedMatch) {
      return reversedMatch[1].trim();
    }
  }
  return '';
}

/**
 * Generate a schema by extracting metadata from an already-fetched HTML page.
 *
 * The caller is responsible for fetching the URL; this function is pure.
 * Returns null for unknown schema types.
 */
export function generateSchemaFromHtml(schemaType: string, url: string, html: string): SchemaObject | null {
  const template = cloneTemplate(schemaType);
  if (!template) {
    return null;
  }

  if (schemaType === 'Article' || schemaType === 'BlogPosting') {
    const headline = extractHtmlTitle(html);
    if (headline) {
      template['headline'] = headline;
    }

    const description = extractMetaContent(html, ['description', 'og:description']);
    if (description) {
      template['description'] = description;
    }

    const author = extractMetaContent(html, ['author']);
    if (author) {
      (template['author'] as SchemaObject)['name'] = author;
    }

    template['url'] = url;
    template['datePublished'] = todayIsoDate();
  }

  if (schemaType === 'Organization') {
    const title = extractHtmlTitle(html);
    template['name'] = title.split('-')[0].split('|')[0].trim();
    template['url'] = url;

    const description = extractMetaContent(html, ['description']);
    if (description) {
      template['description'] = description;
    }
  }

  return template;
}

/** Wrap a schema in an HTML <script type="application/ld+json"> tag. */
export function wrapSchemaAsHtml(schema: SchemaObject): string {
  const jsonStr = JSON.stringify(schema, null, 2);
  return `<script type="application/ld+json">\n${jsonStr}\n</script>`;
}

/** Wrap a schema in a Markdown code block with implementation hints. */
export function wrapSchemaAsMarkdown(schema: SchemaObject): string {
  const jsonStr = JSON.stringify(schema, null, 2);
  const schemaType = (schema['@type'] as string | undefined) ?? 'Unknown';
  return `## ${schemaType} Schema\n\n\`\`\`json\n${jsonStr}\n\`\`\`\n\n**Implementation:** Paste inside \`<head>\` tag\n\n**Validation:** Test at https://validator.schema.org`;
}
