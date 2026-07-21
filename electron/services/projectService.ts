import { getDb } from '../db/connection.ts';
import type { Project } from '@/types/domain';

export function createProject(data: {
  name: string;
  description?: string;
  industry?: string;
  region?: string;
  status?: string;
}): Project {
  const db = getDb();
  const result = db
    .prepare(
      "INSERT INTO projects (name, description, industry, region, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
    )
    .run(
      data.name,
      data.description ?? null,
      data.industry ?? null,
      data.region ?? null,
      data.status ?? 'draft',
    );
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(result.lastInsertRowid)) as Project;
}

export function listProjects(): Project[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM projects WHERE status IS NULL OR status = 'active' ORDER BY updated_at DESC")
    .all() as Project[];
}

export function getProject(id: number): Project | null {
  const db = getDb();
  return (
    (db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined) ?? null
  );
}

export function updateProject(id: number, data: Partial<Project>): void {
  const db = getDb();
  const allowed = ['name', 'description', 'industry', 'region', 'status'] as const;
  const fields: string[] = [];
  const params: unknown[] = [];
  for (const key of allowed) {
    if (key in data) {
      fields.push(`${key} = ?`);
      params.push(data[key]);
    }
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  params.push(id);
  db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteProject(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export function countProjectArtifacts(projectId: number): number {
  const db = getDb();
  const result = db
    .prepare('SELECT COUNT(*) as count FROM agent_artifacts WHERE project_id = ?')
    .get(projectId) as {count: number} | undefined;
  return result?.count ?? 0;
}
