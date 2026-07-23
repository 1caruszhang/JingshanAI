/**
 * Helper module for the `geo-local-optimizer` skill.
 *
 * Provides canonical local page outline sections for single-location pages.
 * Ported from geo_skills/geo-local-optimizer/scripts/generate_local_page_outline.py;
 * pure, deterministic, no external dependencies — safe to import from the
 * Electron main process.
 *
 * When using this module from the skill:
 * - Treat the functions as canonical examples of what a "good" outline should contain.
 * - You can inline or adapt their output shapes inside your final markdown answer.
 */

export interface LocalPageSection {
  id: string;
  title: string;
  description: string;
}

/**
 * Returns the recommended list of sections for a single-location page.
 */
export function getDefaultLocationPageSections(): LocalPageSection[] {
  return [
    {
      id: 'summary',
      title: 'Summary',
      description:
        "2–4 bullets explaining who you are, where you are, who it's for, and what makes it special.",
    },
    {
      id: 'about',
      title: 'About the business',
      description:
        'Short paragraphs describing the business type, concept, and differentiation.',
    },
    {
      id: 'who_we_serve',
      title: 'Who we serve',
      description: 'Profiles of typical customers and visit scenarios.',
    },
    {
      id: 'location',
      title: 'Where we are',
      description: 'Full address, nearby landmarks, and simple directions.',
    },
    {
      id: 'hours_booking',
      title: 'Opening hours & booking',
      description: 'Hours by day type plus contact and booking methods.',
    },
    {
      id: 'products_services',
      title: 'Products & services',
      description: 'Key offerings with short descriptions and who they are best for.',
    },
    {
      id: 'faq',
      title: 'FAQ',
      description: '3–10 concise Q&A items about practical details.',
    },
    {
      id: 'tips',
      title: 'Tips',
      description:
        'Local tips and expectations (peak hours, parking, kid-friendliness, etc.).',
    },
  ];
}

/**
 * Convenience helper: export the default location page outline as a list of
 * plain objects (fresh copies, safe to mutate or serialize). Equivalent to the
 * Python version's `[asdict(section) for section in ...]`.
 */
export function exportLocationPageOutline(): LocalPageSection[] {
  return getDefaultLocationPageSections().map((section) => ({...section}));
}
