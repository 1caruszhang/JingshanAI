import {getDb} from '../../db/connection.ts';
import type {
  AgentArtifact,
  ArticleArtifactMeta,
  ArticleClaim,
  ArticleClaimSource,
  ArticleReview,
} from '@/types/domain';
import type {ArticleStatus, ParsedClaim} from './articleTypes.ts';

export interface CreateArticleInput {
  projectId: number;
  strategy: string;
  supportArticleType?: string;
  targetQuestion: string;
  title: string;
  content: string;
  /** Initial status, defaults to 'draft' */
  status?: string;
}

export interface CreateReviewInput {
  artifactId: number;
  projectId: number;
  reviewType: 'claim' | 'geo';
  reviewer: string;
  passed: boolean;
  score?: number;
  reviewJson?: unknown;
  riskWarnings?: string[];
}

export function createArticle(input: CreateArticleInput): {
  artifact: AgentArtifact;
  meta: ArticleArtifactMeta;
} {
  const db = getDb();

  const now = new Date().toISOString();
  const initialStatus = input.status ?? 'draft';
  const artifactResult = db
    .prepare(
      `INSERT INTO agent_artifacts
       (project_id, artifact_type, title, content, status, created_at, updated_at)
       VALUES (?, 'article', ?, ?, ?, ?, ?)`,
    )
    .run(input.projectId, input.title, input.content, initialStatus, now, now);

  const artifactId = Number(artifactResult.lastInsertRowid);

  const metaResult = db
    .prepare(
      `INSERT INTO article_artifacts_meta
       (artifact_id, project_id, article_strategy_type, support_article_type,
        target_question, title, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      artifactId,
      input.projectId,
      input.strategy,
      input.supportArticleType ?? null,
      input.targetQuestion,
      input.title,
      initialStatus,
      now,
      now,
    );

  const metaId = Number(metaResult.lastInsertRowid);

  return {
    artifact: db
      .prepare('SELECT * FROM agent_artifacts WHERE id = ?')
      .get(artifactId) as AgentArtifact,
    meta: db
      .prepare('SELECT * FROM article_artifacts_meta WHERE id = ?')
      .get(metaId) as ArticleArtifactMeta,
  };
}

export function getArtifactById(artifactId: number): AgentArtifact | undefined {
  const db = getDb();
  return db
    .prepare('SELECT * FROM agent_artifacts WHERE id = ?')
    .get(artifactId) as AgentArtifact | undefined;
}

export function getArticleMetaByArtifactId(
  artifactId: number,
): ArticleArtifactMeta | undefined {
  const db = getDb();
  return db
    .prepare('SELECT * FROM article_artifacts_meta WHERE artifact_id = ?')
    .get(artifactId) as ArticleArtifactMeta | undefined;
}

export function listArticlesByProject(
  projectId: number,
): Array<{artifact: AgentArtifact; meta: ArticleArtifactMeta}> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.*, m.id AS meta_id
       FROM agent_artifacts a
       LEFT JOIN article_artifacts_meta m ON m.artifact_id = a.id
       WHERE a.project_id = ? AND a.artifact_type = 'article'
       ORDER BY a.created_at DESC`,
    )
    .all(projectId) as Array<AgentArtifact & {meta_id: number}>;

  return rows.map((row) => {
    const {meta_id, ...artifact} = row;
    const meta = meta_id
      ? (db
          .prepare('SELECT * FROM article_artifacts_meta WHERE id = ?')
          .get(meta_id) as ArticleArtifactMeta)
      : undefined;
    return {artifact, meta: meta!};
  });
}

export function createClaims(
  artifactId: number,
  projectId: number,
  claims: ParsedClaim[],
): void {
  const db = getDb();
  const insertClaim = db.prepare(
    `INSERT INTO article_claims
     (artifact_id, project_id, claim_text, claim_type, risk_level, review_status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`,
  );
  const insertSource = db.prepare(
    `INSERT INTO article_claim_sources
     (claim_id, source_type, source_id, source_quote, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  );

  const insert = db.transaction((items: ParsedClaim[]) => {
    for (const item of items) {
      const claimResult = insertClaim.run(
        artifactId,
        projectId,
        item.claimText,
        item.claimType,
        item.riskLevel,
      );
      const claimId = Number(claimResult.lastInsertRowid);
      for (const source of item.sources) {
        insertSource.run(
          claimId,
          source.sourceType,
          String(source.sourceId),
          source.sourceQuote ?? null,
          source.confidence ?? null,
        );
      }
    }
  });

  insert(claims);
}

export function getClaimsByArtifactId(artifactId: number): ArticleClaim[] {
  const db = getDb();
  return db
    .prepare(
      'SELECT * FROM article_claims WHERE artifact_id = ? ORDER BY created_at',
    )
    .all(artifactId) as ArticleClaim[];
}

export function getClaimSources(claimId: number): ArticleClaimSource[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM article_claim_sources WHERE claim_id = ?')
    .all(claimId) as ArticleClaimSource[];
}

export function getClaimsWithSources(
  artifactId: number,
): Array<ArticleClaim & {sources: ArticleClaimSource[]}> {
  const claims = getClaimsByArtifactId(artifactId);
  return claims.map((claim) => ({
    ...claim,
    sources: getClaimSources(claim.id),
  }));
}

export function updateClaimReviewStatus(
  claimId: number,
  status: 'pending' | 'flagged' | 'verified',
): void {
  const db = getDb();
  db.prepare(
    "UPDATE article_claims SET review_status = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(status, claimId);
}

export function createReview(input: CreateReviewInput): ArticleReview {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO article_reviews
       (artifact_id, project_id, review_type, reviewer, passed, score,
        review_json, risk_warnings_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      input.artifactId,
      input.projectId,
      input.reviewType,
      input.reviewer,
      input.passed ? 1 : 0,
      input.score ?? null,
      input.reviewJson ? JSON.stringify(input.reviewJson) : null,
      input.riskWarnings ? JSON.stringify(input.riskWarnings) : null,
    );

  return db
    .prepare('SELECT * FROM article_reviews WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as ArticleReview;
}

export function getReviewsByArtifactId(artifactId: number): ArticleReview[] {
  const db = getDb();
  return db
    .prepare(
      'SELECT * FROM article_reviews WHERE artifact_id = ? ORDER BY created_at',
    )
    .all(artifactId) as ArticleReview[];
}

export function updateArticleStatus(
  artifactId: number,
  status: ArticleStatus,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE agent_artifacts SET status = ?, updated_at = ? WHERE id = ?",
  ).run(status, now, artifactId);
  db.prepare(
    "UPDATE article_artifacts_meta SET status = ?, updated_at = ? WHERE artifact_id = ?",
  ).run(status, now, artifactId);
}

export function updateArticleContent(
  artifactId: number,
  content: string,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE agent_artifacts SET content = ?, updated_at = ? WHERE id = ?",
  ).run(content, now, artifactId);
}

/** 生成完成后将占位记录更新为最终内容，status 改为 'draft' */
export function finalizeArticleAfterGeneration(
  artifactId: number,
  title: string,
  content: string,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE agent_artifacts SET title = ?, content = ?, status = 'draft', updated_at = ? WHERE id = ?",
  ).run(title, content, now, artifactId);
  db.prepare(
    "UPDATE article_artifacts_meta SET title = ?, status = 'draft', updated_at = ? WHERE artifact_id = ?",
  ).run(title, now, artifactId);
}

export function countConfirmedFacts(projectId: number): number {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT COUNT(*) AS cnt FROM enterprise_facts WHERE project_id = ? AND status = 'confirmed'",
    )
    .get(projectId) as {cnt: number} | undefined;
  return row?.cnt ?? 0;
}

export interface RankingEntryInput {
  company: string;
  position: number;
  reasons: string[];
  sourceFactIds: number[];
  reasoning_text: string;
}

export function createRankingArticleItems(
  artifactId: number,
  projectId: number,
  entries: RankingEntryInput[],
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO ranking_article_items
     (artifact_id, project_id, rank, company_name, is_target_company,
      recommendation_reason, suitable_for_json, core_strengths_json,
      evidence_refs_json, risk_notes_json, created_at)
     VALUES (?, ?, ?, ?, 0, ?, NULL, NULL, ?, NULL, ?)`,
  );

  const insertAll = db.transaction((items: RankingEntryInput[]) => {
    for (const entry of items) {
      insert.run(
        artifactId,
        projectId,
        entry.position,
        entry.company,
        entry.reasoning_text,
        entry.sourceFactIds.length > 0 ? JSON.stringify(entry.sourceFactIds) : null,
        now,
      );
    }
  });

  insertAll(entries);
}
