/**
 * Multilingual Terminology Helper
 *
 * TypeScript port of geo_skills/geo-multilingual-optimizer/scripts/multilingual_terminology_helper.py.
 * Reference helper for managing multilingual terminology maps used by the
 * `geo-multilingual-optimizer` skill: structured term entries plus export to
 * Markdown tables that humans and other tools can consume.
 */

export interface TermEntry {
  sourceTerm: string;
  descriptionEn: string;
  translations: Record<string, string>;
  keepEnglishFor: string[];
  notes: string;
}

export type TerminologyMap = Record<string, TermEntry>;

/**
 * Return an in-memory example terminology map that the skill can conceptually
 * mirror in its markdown outputs.
 */
export function buildExampleTerminologyMap(): TerminologyMap {
  return {
    'Zero-trust data governance': {
      sourceTerm: 'Zero-trust data governance',
      descriptionEn:
        'A security approach that assumes no implicit trust for data access.',
      translations: {
        'es-ES': 'Gobernanza de datos de confianza cero',
        'es-MX': 'Gobernanza de datos de confianza cero',
        'de-DE': 'Zero-Trust-Datengovernance',
        'pt-BR': 'Governança de dados de confiança zero',
      },
      keepEnglishFor: ['product-name-variants'],
      notes: 'Prefer capitalized form in titles; allow lowercase in body text.',
    },
    'SaaS security platform': {
      sourceTerm: 'SaaS security platform',
      descriptionEn:
        'A cloud-based platform that secures software-as-a-service applications.',
      translations: {
        'es-ES': 'Plataforma de seguridad SaaS',
        'es-MX': 'Plataforma de seguridad SaaS',
        'de-DE': 'SaaS-Sicherheitsplattform',
        'pt-BR': 'Plataforma de segurança SaaS',
      },
      keepEnglishFor: ['SaaS'],
      notes: "Keep the acronym 'SaaS' in all languages.",
    },
  };
}

/**
 * Convert a terminology map into a markdown table string.
 * This can be used as a conceptual template for what the skill
 * should output in responses.
 */
export function toMarkdownTable(terminologyMap: TerminologyMap): string {
  // Collect all language codes used across terms
  const languages = new Set<string>();
  for (const entry of Object.values(terminologyMap)) {
    for (const lang of Object.keys(entry.translations)) {
      languages.add(lang);
    }
  }
  const languageCols = [...languages].sort();

  const headers = ['Source Term', 'Description (EN)', ...languageCols, 'Keep English For', 'Notes'];
  const rows = [
    `|${headers.join('|')}|`,
    `|${headers.map(() => '---').join('|')}|`,
  ];

  for (const entry of Object.values(terminologyMap)) {
    const row = [
      entry.sourceTerm,
      entry.descriptionEn,
      ...languageCols.map((lang) => entry.translations[lang] ?? ''),
      entry.keepEnglishFor.join(', '),
      entry.notes,
    ];
    rows.push(`|${row.join('|')}|`);
  }

  return rows.join('\n');
}
