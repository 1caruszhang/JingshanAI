import type {IpcChannels} from '../../electron/ipc/channels.ts';

export const api = {
  invoke: <T extends keyof IpcChannels>(
    channel: T,
    ...args: Parameters<IpcChannels[T]>
  ): Promise<ReturnType<IpcChannels[T]>> => {
    return window.electron.invoke(channel, ...args);
  },

  on: (channel: string, callback: (...args: unknown[]) => void) => {
    return window.electron.on(channel, callback);
  },
};

export const dbApi = {
  query: (sql: string, params?: unknown[]) => api.invoke('db:query', sql, params),
  exec: (sql: string, params?: unknown[]) => api.invoke('db:exec', sql, params),
  migrate: () => api.invoke('db:migrate'),
  vectorSearch: (table: string, queryVector: number[], limit = 10) =>
    api.invoke('db:vectorSearch', {table, queryVector, limit}),
};

export const dialogApi = {
  openFile: (options?: Parameters<IpcChannels['dialog:openFile']>[0]) =>
    api.invoke('dialog:openFile', options),
};

export const appApi = {
  getPath: (name: Parameters<IpcChannels['app:getPath']>[0]) =>
    api.invoke('app:getPath', name),
};

export const kbApi = {
  ingestText: (projectId: number, title: string, content: string) =>
    api.invoke('kb:ingestText', {projectId, title, content}),
  ingestFile: (projectId: number, title: string, filePath: string) =>
    api.invoke('kb:ingestFile', {projectId, title, filePath}),
  indexEntry: (entryId: number) => api.invoke('kb:indexEntry', {entryId}),
  search: (projectId: number, query: string, limit?: number) =>
    api.invoke('kb:search', {projectId, query, limit}),
  facts: (projectId: number) => api.invoke('kb:facts', projectId),
  factsUpdate: (id: number, status: Parameters<IpcChannels['kb:factsUpdate']>[1]) =>
    api.invoke('kb:factsUpdate', id, status),
};

export const factApi = {
  extract: (params: Parameters<IpcChannels['fact:extract']>[0]) =>
    api.invoke('fact:extract', params),
  list: (params: Parameters<IpcChannels['fact:list']>[0]) =>
    api.invoke('fact:list', params),
  listPending: (params: Parameters<IpcChannels['fact:listPending']>[0]) =>
    api.invoke('fact:listPending', params),
  confirm: (params: Parameters<IpcChannels['fact:confirm']>[0]) =>
    api.invoke('fact:confirm', params),
  reject: (params: Parameters<IpcChannels['fact:reject']>[0]) =>
    api.invoke('fact:reject', params),
  modifyAndConfirm: (params: Parameters<IpcChannels['fact:modifyAndConfirm']>[0]) =>
    api.invoke('fact:modifyAndConfirm', params),
  missingFields: (projectId: number) => api.invoke('fact:missingFields', projectId),
  parseReviewIntent: (params: Parameters<IpcChannels['fact:parseReviewIntent']>[0]) =>
    api.invoke('fact:parseReviewIntent', params),
};

export const ragApi = {
  ask: (projectId: number, query: string, limit?: number) =>
    api.invoke('rag:ask', {projectId, query, limit}),
};

export const projectApi = {
  create: (data: Parameters<IpcChannels['project:create']>[0]) => api.invoke('project:create', data),
  list: () => api.invoke('project:list'),
  get: (id: number) => api.invoke('project:get', id),
  update: (id: number, data: Parameters<IpcChannels['project:update']>[1]) =>
    api.invoke('project:update', id, data),
  delete: (id: number) => api.invoke('project:delete', id),
  artifactCount: (id: number) => api.invoke('project:artifactCount', id),
};

export const assistantApi = {
  streamStart: (params: Parameters<IpcChannels['assistant:streamStart']>[0]) =>
    api.invoke('assistant:streamStart', params),
  streamCancel: (requestId: string) =>
    api.invoke('assistant:streamCancel', requestId),
  history: (sessionId: number, limit?: number) =>
    api.invoke('assistant:history', sessionId, limit),
  queueList: (runId: number) => api.invoke('assistant:queueList', runId),
  queueUpdate: (
    itemId: number,
    status: string,
    metadata?: Record<string, unknown>,
  ) => api.invoke('assistant:queueUpdate', itemId, status, metadata),
};

export const toolApprovalApi = {
  respond: (approvalId: number, approved: boolean, note?: string) =>
    api.invoke('toolApproval:respond', approvalId, approved, note),
  listPending: () => api.invoke('toolApproval:listPending'),
};

export const agentTaskApi = {
  create: (params: Parameters<IpcChannels['agentTask:create']>[0]) =>
    api.invoke('agentTask:create', params),
  run: (params: Parameters<IpcChannels['agentTask:run']>[0]) =>
    api.invoke('agentTask:run', params),
  get: (id: number) => api.invoke('agentTask:get', id),
  list: (filters?: Parameters<IpcChannels['agentTask:list']>[0]) => api.invoke('agentTask:list', filters),
  resume: (id: number) => api.invoke('agentTask:resume', id),
  pause: (id: number) => api.invoke('agentTask:pause', id),
  cancel: (id: number) => api.invoke('agentTask:cancel', id),
  retry: (id: number) => api.invoke('agentTask:retry', id),
  timeline: (id: number) => api.invoke('agentTask:timeline', id),
  artifacts: (id: number) => api.invoke('agentTask:artifacts', id),
};

export const draftApi = {
  list: (projectId: number) => api.invoke('draft:list', projectId),
  get: (id: number) => api.invoke('draft:get', id),
  update: (id: number, content: string, status?: string) =>
    api.invoke('draft:update', id, content, status),
  review: (id: number, approved: boolean, note?: string) =>
    api.invoke('draft:review', id, approved, note),
};

export const publishApi = {
  plan: (params: Parameters<IpcChannels['publish:plan']>[0]) =>
    api.invoke('publish:plan', params),
  approve: (params: Parameters<IpcChannels['publish:approve']>[0]) =>
    api.invoke('publish:approve', params),
  status: (publishRecordId: number) =>
    api.invoke('publish:status', publishRecordId),
};

export const visibilityApi = {
  check: (params: Parameters<IpcChannels['visibility:check']>[0]) =>
    api.invoke('visibility:check', params),
};

export const reflectionApi = {
  list: (filters?: Parameters<IpcChannels['reflection:list']>[0]) =>
    api.invoke('reflection:list', filters),
  approve: (id: number) => api.invoke('reflection:approve', id),
  reject: (id: number) => api.invoke('reflection:reject', id),
  archive: (id: number) => api.invoke('reflection:archive', id),
};

export const articleApi = {
  generate: (params: Parameters<IpcChannels['article:generate']>[0]) =>
    api.invoke('article:generate', params),
  generateRanking: (params: Parameters<IpcChannels['article:generateRanking']>[0]) =>
    api.invoke('article:generateRanking', params),
  list: (projectId: number) => api.invoke('article:list', projectId),
  get: (artifactId: number) => api.invoke('article:get', artifactId),
  claimReview: (artifactId: number) => api.invoke('article:claimReview', artifactId),
  geoReview: (artifactId: number) => api.invoke('article:geoReview', artifactId),
  updateStatus: (
    artifactId: number,
    status: Parameters<IpcChannels['article:updateStatus']>[1],
  ) => api.invoke('article:updateStatus', artifactId, status),
  updateContent: (artifactId: number, content: string) => api.invoke('article:updateContent', artifactId, content),
};

export const questionApi = {
  generate: (projectId: number) => api.invoke('question:generate', projectId),
  list: (projectId: number) => api.invoke('question:list', projectId),
  select: (id: number) => api.invoke('question:select', id),
  reject: (id: number) => api.invoke('question:reject', id),
};

export const sourceApi = {
  discover: (projectId: number, targetQuestion: string) =>
    api.invoke('source:discover', projectId, targetQuestion),
  adopt: (
    projectId: number,
    targetQuestion: string,
    source: Parameters<IpcChannels['source:adopt']>[2],
  ) => api.invoke('source:adopt', projectId, targetQuestion, source),
  skip: (
    projectId: number,
    targetQuestion: string,
    source: Parameters<IpcChannels['source:skip']>[2],
  ) => api.invoke('source:skip', projectId, targetQuestion, source),
  listDecisions: (projectId: number, targetQuestion: string) =>
    api.invoke('source:listDecisions', projectId, targetQuestion),
  clearDecisions: (projectId: number, targetQuestion: string) =>
    api.invoke('source:clearDecisions', projectId, targetQuestion),
  removeDecision: (projectId: number, targetQuestion: string, url: string) =>
    api.invoke('source:removeDecision', projectId, targetQuestion, url),
};

export const titleApi = {
  generate: (projectId: number, targetQuestion: string) =>
    api.invoke('title:generate', projectId, targetQuestion),
};

export const settingsApi = {
  get: () => api.invoke('settings:get'),
  set: (patch: Parameters<IpcChannels['settings:set']>[0]) => api.invoke('settings:set', patch),
};
