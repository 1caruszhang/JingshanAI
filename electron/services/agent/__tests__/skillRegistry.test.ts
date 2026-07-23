/**
 * skillRegistry.test.ts
 *
 * Tests for issue #55 — frontmatter expand phase.
 * Verifies:
 *  - new optional fields (needsKb/outputSchema/tools/examples) are accepted
 *  - legacy fields (domains/capabilities/preconditions/requires_confirmation)
 *    are now optional and do not break loading
 *  - getSkill(name).frontmatter.needsKb is readable (undefined) for existing skills
 *  - all existing SKILL.md files load without throwing
 */

import {describe, it, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';

import {
  loadAllSkills,
  getSkill,
  _resetCache,
  validateFrontmatter,
} from '../skillRegistry.ts';

const SKILLS_DIR = join(process.cwd(), 'skills');

describe('skillRegistry frontmatter expand (#55)', () => {
  beforeEach(() => {
    _resetCache();
  });

  it('loads all existing SKILL.md files without throwing', () => {
    const dirNames = readdirSync(SKILLS_DIR, {withFileTypes: true})
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    assert.ok(dirNames.length > 0, 'expected at least one skill directory');

    // Should not throw.
    const loaded = loadAllSkills({skillsDir: SKILLS_DIR});
    assert.equal(loaded.length, dirNames.length);
  });

  it('getSkill(name).frontmatter.needsKb is readable for existing skills', () => {
    const skill = getSkill('title-generation');
    assert.ok(skill, 'title-generation skill should exist');
    // Field must be readable without throwing. title-generation now declares
    // needsKb:false (#57); other legacy skills leave it undefined.
    assert.equal(skill!.frontmatter.needsKb, false);
  });

  it('accepts a minimal frontmatter with only name (legacy fields optional)', () => {
    // Only the truly required fields remain; legacy fields are now optional.
    const fm = validateFrontmatter(
      {
        name: 'test-skill',
        description: 'a minimal skill for testing purposes',
        risk_level: 'low',
      },
      'test/SKILL.md',
    );
    assert.equal(fm.name, 'test-skill');
    assert.equal(fm.domains, undefined);
    assert.equal(fm.capabilities, undefined);
    assert.equal(fm.preconditions, undefined);
    assert.equal(fm.requires_confirmation, undefined);
  });

  it('accepts new optional fields when present', () => {
    const fm = validateFrontmatter(
      {
        name: 'test-skill',
        description: 'a skill with the new optional fields declared',
        risk_level: 'low',
        needsKb: true,
        outputSchema: '{ "type": "object" }',
        tools: 'search,write',
        examples: 'example prompt',
      },
      'test/SKILL.md',
    );
    assert.equal(fm.needsKb, true);
    assert.equal(fm.outputSchema, '{ "type": "object" }');
    assert.equal(fm.tools, 'search,write');
    assert.equal(fm.examples, 'example prompt');
  });

  it('still validates legacy fields when they are present', () => {
    assert.throws(
      () =>
        validateFrontmatter(
          {
            name: 'test-skill',
            description: 'a skill with an invalid legacy domain value',
            risk_level: 'low',
            domains: ['not_a_domain'],
          },
          'test/SKILL.md',
        ),
      /invalid domain/,
    );
  });
});
