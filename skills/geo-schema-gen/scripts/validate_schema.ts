/**
 * Validate Schema.org JSON-LD markup.
 *
 * Pure, deterministic validation logic (no CLI, no I/O).
 * Migrated from geo_skills/geo-schema-gen/scripts/validate_schema.py.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
}

export interface ValidateSchemaOptions {
  /** Treat warnings as errors when computing `valid`. */
  strict?: boolean;
}

type SchemaObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is SchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class SchemaValidator {
  private errors: string[] = [];
  private warnings: string[] = [];
  private info: string[] = [];

  validate(schema: unknown): Omit<ValidationResult, 'valid'> {
    this.validateStructure(schema);
    if (isPlainObject(schema)) {
      this.validateContext(schema);
      this.validateRequiredFields(schema);
      this.validateBestPractices(schema);
    }

    return {
      errors: this.errors,
      warnings: this.warnings,
      info: this.info,
    };
  }

  private validateStructure(schema: unknown): void {
    if (!isPlainObject(schema)) {
      this.errors.push('Schema must be a JSON object');
      return;
    }

    if (!('@context' in schema)) {
      this.errors.push('Missing @context field');
    }

    if (!('@type' in schema) && !('@graph' in schema)) {
      this.errors.push('Missing @type or @graph field');
    }
  }

  private validateContext(schema: SchemaObject): void {
    const context = schema['@context'] ?? '';

    if (typeof context === 'string') {
      if (context === 'http://schema.org') {
        this.warnings.push('@context uses HTTP (should be HTTPS)');
      } else if (context !== 'https://schema.org') {
        this.warnings.push(`Unexpected @context value: ${context}`);
      }
    } else if (isPlainObject(context)) {
      if (!JSON.stringify(context).includes('schema.org')) {
        this.warnings.push('@context may not include schema.org');
      }
    }
  }

  private validateRequiredFields(schema: SchemaObject): void {
    const schemaType = (schema['@type'] as string | undefined) ?? '';

    if (schemaType === 'Organization') {
      this.checkRequired(schema, ['name', 'url'], 'Organization');
      if (!('logo' in schema)) {
        this.warnings.push('Organization should include logo');
      }
    } else if (schemaType === 'WebSite') {
      this.checkRequired(schema, ['name', 'url'], 'WebSite');
    } else if (schemaType === 'Article' || schemaType === 'BlogPosting') {
      this.checkRequired(schema, ['headline', 'author', 'datePublished'], schemaType);
      if (!('publisher' in schema)) {
        this.warnings.push(`${schemaType} should include publisher`);
      }
      if (!('image' in schema)) {
        this.warnings.push(`${schemaType} should include image for rich results`);
      }
    } else if (schemaType === 'Product') {
      this.checkRequired(schema, ['name'], 'Product');
      if (!('offers' in schema) && !('review' in schema)) {
        this.errors.push('Product must have offers or review');
      }
      if ('offers' in schema) {
        this.validateOffer(schema['offers']);
      }
    } else if (schemaType === 'FAQPage') {
      this.checkRequired(schema, ['mainEntity'], 'FAQPage');
      if ('mainEntity' in schema) {
        if (!Array.isArray(schema['mainEntity'])) {
          this.errors.push('FAQPage mainEntity must be an array');
        } else {
          schema['mainEntity'].forEach((item, i) => {
            const question = isPlainObject(item) ? item : {};
            if (question['@type'] !== 'Question') {
              this.errors.push(`FAQ item ${i + 1} must be @type: Question`);
            }
            if (!('acceptedAnswer' in question)) {
              this.errors.push(`FAQ item ${i + 1} missing acceptedAnswer`);
            }
          });
        }
      }
    } else if (schemaType === 'HowTo') {
      this.checkRequired(schema, ['name', 'step'], 'HowTo');
    } else if (schemaType === 'BreadcrumbList') {
      this.checkRequired(schema, ['itemListElement'], 'BreadcrumbList');
      if (Array.isArray(schema['itemListElement'])) {
        schema['itemListElement'].forEach((item, i) => {
          if (!isPlainObject(item) || !('position' in item)) {
            this.errors.push(`Breadcrumb item ${i + 1} missing position`);
          }
        });
      }
    } else if (schemaType === 'LocalBusiness') {
      this.checkRequired(schema, ['name', 'address'], 'LocalBusiness');
    }
  }

  private checkRequired(schema: SchemaObject, fields: string[], schemaType: string): void {
    for (const field of fields) {
      const value = schema[field];
      if (!(field in schema) || !value) {
        this.errors.push(`${schemaType} missing required field: ${field}`);
      }
    }
  }

  private validateOffer(offer: unknown): void {
    if (!isPlainObject(offer)) {
      this.errors.push('Product offers must be an object');
      return;
    }

    if (!('price' in offer)) {
      this.errors.push('Offer missing price');
    } else if (typeof offer['price'] === 'string' && !/^\d+(\.\d{2})?$/.test(offer['price'])) {
      if (offer['price'].includes('$') || offer['price'].includes('€') || offer['price'].includes('£')) {
        this.errors.push('Price should not include currency symbol');
      }
    }

    if (!('priceCurrency' in offer)) {
      this.warnings.push('Offer should specify priceCurrency');
    }
  }

  private validateBestPractices(schema: SchemaObject): void {
    // Check for https in URLs
    for (const [key, value] of Object.entries(schema)) {
      if (typeof value === 'string' && value.startsWith('http://')) {
        this.warnings.push(`${key} uses HTTP (consider HTTPS)`);
      }
    }

    // Check description length
    if ('description' in schema && typeof schema['description'] === 'string') {
      const desc = schema['description'];
      if (desc.length < 50) {
        this.warnings.push('Description is quite short (< 50 chars)');
      }
      if (desc.length > 500) {
        this.warnings.push('Description is quite long (> 500 chars)');
      }
    }

    // Check for promotional language
    const promotional = ['best', 'revolutionary', 'amazing', 'incredible', 'unmatched'];
    const schemaStr = JSON.stringify(schema).toLowerCase();
    const found = promotional.filter((p) => schemaStr.includes(p));
    if (found.length > 0) {
      this.warnings.push(`Promotional language detected: ${found.join(', ')}`);
    }

    // Check for empty values
    this.checkEmptyValues(schema);
  }

  private checkEmptyValues(data: unknown, path = ''): void {
    if (Array.isArray(data)) {
      data.forEach((item, i) => {
        this.checkEmptyValues(item, `${path}[${i}]`);
      });
      return;
    }

    if (isPlainObject(data)) {
      for (const [key, value] of Object.entries(data)) {
        const currentPath = path ? `${path}.${key}` : key;
        const isEmpty =
          value === '' ||
          (Array.isArray(value) && value.length === 0) ||
          (isPlainObject(value) && Object.keys(value).length === 0);
        if (isEmpty) {
          this.warnings.push(`Empty value for: ${currentPath}`);
        } else if (isPlainObject(value) || Array.isArray(value)) {
          this.checkEmptyValues(value, currentPath);
        }
      }
    }
  }
}

/**
 * Validate a Schema.org JSON-LD object.
 *
 * Returns errors / warnings / info lists plus a `valid` flag.
 * With `strict: true`, warnings also make the schema invalid
 * (mirrors the original CLI `--strict` flag).
 */
export function validateSchema(schema: unknown, options: ValidateSchemaOptions = {}): ValidationResult {
  const validator = new SchemaValidator();
  const result = validator.validate(schema);

  const valid = result.errors.length === 0 && (!options.strict || result.warnings.length === 0);

  return {
    valid,
    errors: result.errors,
    warnings: result.warnings,
    info: result.info,
  };
}
