import 'dotenv/config';
import {app} from 'electron';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {setApp} from '../electron/utils/paths.ts';
import {getDb} from '../electron/db/connection.ts';
import {indexEntry} from '../electron/services/indexingService.ts';
import {runMinimalAgentTask} from '../electron/services/agent/geoAgentRuntime.ts';

const testDir = mkdtempSync(join(tmpdir(), 'nai-agent-deepagent-e-'));

// 在 app ready 前把 userData 指向临时目录，DB 会初始化到这里
app.setPath('userData', testDir);
setApp(app);

async function main() {
  const db = getDb();

  const projectResult = db
    .prepare("INSERT INTO projects (name, description, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))")
    .run('DeepAgent Test Project', '用于验证最小 DeepAgent');
  const projectId = Number(projectResult.lastInsertRowid);
  console.log('Created project:', projectId);

  const entryResult = db
    .prepare(
      "INSERT INTO knowledge_entries (project_id, title, content, source_type, source_file_path, status, created_at) VALUES (?, ?, ?, 'text', null, 'pending', datetime('now'))",
    )
    .run(
      projectId,
      'GEO Agent 介绍',
      'GEO Agent 是 NAI Labs 于 2024 年开发的企业 GEO 优化平台，帮助企业提升在 AI 生成搜索结果中的可见性。总部在杭州。',
    );
  const entryId = Number(entryResult.lastInsertRowid);
  console.log('Created entry:', entryId);

  const indexResult = await indexEntry(entryId);
  console.log('Indexed:', indexResult);
  if (indexResult.status !== 'indexed' || indexResult.chunkCount === 0) {
    throw new Error('Knowledge indexing failed or produced no chunks');
  }

  const task = await runMinimalAgentTask('GEO Agent 是什么公司开发的？总部在哪里？', {
    projectId,
    title: 'DeepAgent 验证问题',
  });

  console.log('Task result:', {
    id: task.id,
    status: task.status,
    current_objective: task.current_objective,
  });

  const steps = db.prepare('SELECT * FROM agent_task_steps WHERE task_id = ? ORDER BY created_at ASC').all(task.id);
  console.log('Steps:', steps.map((s: unknown) => {
    const step = s as {step_type: string; action_name: string | null; status: string};
    return {step_type: step.step_type, action_name: step.action_name, status: step.status};
  }));

  const artifact = db
    .prepare('SELECT * FROM agent_artifacts WHERE task_id = ? AND artifact_type = ?')
    .get(task.id, 'agent_response') as {content: string} | undefined;
  console.log('Artifact answer:', artifact?.content ?? '(none)');

  if (task.status !== 'completed') {
    throw new Error(`Task did not complete: ${task.status}`);
  }
  console.log('✅ Project-aware DeepAgent test passed');

  // 2. 全局闲聊模式（无项目）
  const globalTask = await runMinimalAgentTask('GEO 是什么？');
  console.log('Global task result:', {
    id: globalTask.id,
    status: globalTask.status,
    current_objective: globalTask.current_objective,
  });

  const globalArtifact = db
    .prepare('SELECT * FROM agent_artifacts WHERE task_id = ? AND artifact_type = ?')
    .get(globalTask.id, 'agent_response') as {content: string} | undefined;
  console.log('Global artifact answer:', globalArtifact?.content ?? '(none)');

  if (globalTask.status !== 'completed') {
    throw new Error(`Global task did not complete: ${globalTask.status}`);
  }
  console.log('✅ Global DeepAgent test passed');
  console.log('✅ All DeepAgent integration tests passed');
}

app.whenReady().then(async () => {
  try {
    await main();
    app.quit();
  } catch (err) {
    console.error('Test failed:', err);
    app.exit(1);
  } finally {
    try {
      rmSync(testDir, {recursive: true, force: true});
    } catch {
      // ignore cleanup errors
    }
  }
});
