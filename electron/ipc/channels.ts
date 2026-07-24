import type {
  AgentArtifact,
  AgentTask,
  AgentTaskStep,
  ArticleArtifactMeta,
  ArticleClaim,
  ArticleClaimSource,
  ArticleGenerateResult,
  ArticleReview,
  ChatMessage,
  EnterpriseFact,
  FactReviewIntent,
  FactStatus,
  InterruptDecision,
  Project,
  PublishRecord,
  QuestionPoolItem,
  RankingArticleParams,
  ReflectionHypothesis,
  SourceRecommendation,
  SourceDecision,
  TitleCandidate,
  ToolApproval,
  UserSettings,
  VisibilityCheck,
} from '@/types/domain';

import type {FactExtractionResult} from '../services/facts/factTypes.ts';
import type {ClaimReviewResult} from '../services/article/claimReviewService.ts';
import type {GeoReviewResult} from '../services/article/geoReviewService.ts';

interface IndexingResult {
  entryId: number;
  chunkCount: number;
  status: 'pending' | 'indexed' | 'failed';
  error?: string;
}

interface KnowledgeSearchResult {
  chunkId: number;
  distance: number;
  chunkText: string;
  chunkIndex: number;
  entryId: number;
  entryTitle: string;
  sourceType: string | null;
  sourceFilePath: string | null;
}

interface RagAnswer {
  answer: string;
  sources: Array<{
    chunkId: number;
    entryId: number;
    entryTitle: string;
    chunkText: string;
    chunkIndex: number;
    sourceType: string | null;
    sourceFilePath: string | null;
  }>;
  model: string;
}

interface AssistantStreamStartResult {
  runId: number;
}

interface PublishPlanInput {
  artifactId: number;
  projectId: number;
  channels: Array<{
    name: string;
    platform: string;
    channelType?: string;
  }>;
}

export interface IpcChannels {
  ping: () => 'pong';

  'db:query': (sql: string, params?: unknown[]) => unknown[];
  'db:exec': (sql: string, params?: unknown[]) => {changes: number; lastInsertRowid: number | bigint};
  'db:migrate': () => {currentVersion: number; targetVersion: number};
  'db:vectorSearch': (params: {
    table: string;
    queryVector: number[];
    limit: number;
  }) => Array<{rowid: number; distance: number}>;

  'dialog:openFile': (options?: {
    multiple?: boolean;
    filters?: Array<{name: string; extensions: string[]}>;
  }) => string[];

  'app:getPath': (name: 'userData' | 'home' | 'downloads') => string;

  // 项目
  'project:create': (data: {name: string; description?: string; industry?: string; region?: string}) => Project;
  'project:list': () => Project[];
  'project:get': (id: number) => Project | null;
  'project:update': (id: number, data: Partial<Project>) => void;
  'project:delete': (id: number) => void;
  'project:artifactCount': (projectId: number) => number;

  // 知识库
  'kb:ingestText': (params: {
    projectId: number;
    title: string;
    content: string;
  }) => IndexingResult;
  'kb:ingestFile': (params: {
    projectId: number;
    title: string;
    filePath: string;
  }) => IndexingResult;
  'kb:indexEntry': (params: {entryId: number}) => IndexingResult;
  'kb:search': (params: {
    projectId: number;
    query: string;
    limit?: number;
  }) => KnowledgeSearchResult[];
  'kb:facts': (projectId: number) => EnterpriseFact[];
  'kb:factsUpdate': (id: number, status: EnterpriseFact['status']) => void;

  // 事实抽取与审核
  'fact:extract': (params: {
    projectId: number;
    entryId?: number;
    chunkIds?: number[];
    mode?: 'ontology' | 'free';
    formInputs?: Record<string, string>;
  }) => FactExtractionResult;
  'fact:list': (params: {
    projectId: number;
    status?: FactStatus;
    factType?: string;
    limit?: number;
    offset?: number;
  }) => {facts: EnterpriseFact[]; total: number};
  'fact:listPending': (params: {projectId: number; sessionId?: number}) => EnterpriseFact[];
  'fact:confirm': (params: {factIds: number[]; reviewerNote?: string}) => {confirmed: number[]};
  'fact:reject': (params: {factIds: number[]; reviewerNote?: string}) => {rejected: number[]};
  'fact:modifyAndConfirm': (params: {
    factId: number;
    newFactValue: string;
    newFactType?: string;
    reviewMessageId?: number;
  }) => EnterpriseFact;
  'fact:missingFields': (projectId: number) => {missing: string[]; riskWarnings: string[]};
  'fact:parseReviewIntent': (params: {
    text: string;
    facts: {factId: number; displayIndex: number; factType: string; factValue: string}[];
  }) => FactReviewIntent;

  'rag:ask': (params: {
    projectId: number;
    query: string;
    limit?: number;
  }) => RagAnswer;

  // Assistant Runtime
  'assistant:streamStart': (params: {
    sessionId?: number;
    projectId?: number;
    requestId: string;
    runType?: string;
  }) => AssistantStreamStartResult;
  'assistant:streamCancel': (requestId: string) => void;
  'assistant:history': (sessionId: number, limit?: number) => ChatMessage[];
  'assistant:queueList': (runId: number) => Array<Record<string, unknown>>;
  'assistant:queueUpdate': (itemId: number, status: string, metadata?: Record<string, unknown>) => void;

  // 工具审批
  'toolApproval:respond': (approvalId: number, approved: boolean, note?: string) => void;
  'toolApproval:listPending': () => ToolApproval[];

  // Agent Task Runtime
  'agentTask:create': (params: {
    sessionId?: number;
    projectId?: number;
    title?: string;
    userGoal: string;
  }) => AgentTask;
  'agentTask:run': (params: {
    sessionId?: number;
    projectId?: number;
    title?: string;
    userGoal: string;
    /** #90: 文件附件列表（名称、类型、字节数、可选的 base64 内容） */
    files?: Array<{name: string; type: string; bytes: number; content?: string}>;
  }) => AgentTask;
  'agentTask:get': (id: number) => AgentTask | null;
  'agentTask:list': (filters?: {projectId?: number; status?: string; limit?: number}) => AgentTask[];
  'agentTask:resume': (id: number, resumeValue?: unknown) => AgentTask;
  /** #79: Respond to a HITL interrupt with structured decisions (approve/reject per tool). */
  'agentTask:respondInterrupt': (taskId: number, decisions: InterruptDecision[]) => AgentTask;
  'agentTask:pause': (id: number) => void;
  'agentTask:cancel': (id: number) => void;
  'agentTask:retry': (id: number) => void;
  'agentTask:timeline': (id: number) => AgentTaskStep[];
  'agentTask:artifacts': (id: number) => AgentArtifact[];

  // 草稿 / 产物
  'draft:list': (projectId: number) => AgentArtifact[];
  'draft:get': (id: number) => AgentArtifact | null;
  'draft:update': (id: number, content: string, status?: string) => void;
  'draft:review': (id: number, approved: boolean, note?: string) => void;

  // 发布
  'publish:plan': (params: PublishPlanInput) => PublishRecord[];
  'publish:approve': (params: {publishRecordIds: number[]; approved: boolean}) => void;
  'publish:status': (publishRecordId: number) => PublishRecord | null;

  // 可见性
  'visibility:check': (params: {publishRecordId: number; query?: string}) => VisibilityCheck;

  // 反思假设
  'reflection:list': (filters?: {status?: string; scope?: string}) => ReflectionHypothesis[];
  'reflection:approve': (id: number) => void;
  'reflection:reject': (id: number) => void;
  'reflection:archive': (id: number) => void;

  // 文章生成
  'article:generate': (params: {
    projectId: number;
    strategy: 'support_article';
    supportArticleType?: string;
    targetQuestion: string;
    title?: string;
    adoptedSources?: SourceRecommendation[];
  }) => {artifact: AgentArtifact; meta: ArticleArtifactMeta; claims: ArticleClaim[]};

  'article:list': (projectId: number) => Array<{artifact: AgentArtifact; meta: ArticleArtifactMeta}>;

  'article:get': (artifactId: number) => {
    artifact: AgentArtifact;
    meta: ArticleArtifactMeta;
    claims: Array<ArticleClaim & {sources: ArticleClaimSource[]}>;
    reviews: ArticleReview[];
  };

  'article:claimReview': (artifactId: number) => ClaimReviewResult;
  'article:geoReview': (artifactId: number) => GeoReviewResult;
  'article:updateStatus': (
    artifactId: number,
    status: 'draft' | 'claim_reviewed' | 'geo_reviewed' | 'approved' | 'rejected',
  ) => void;
  'article:updateContent': (artifactId: number, content: string) => void;

  // Phase 7：问题池、信源发现、标题生成、排行榜文章
  'question:generate': (projectId: number) => QuestionPoolItem[];
  'question:list': (projectId: number) => QuestionPoolItem[];
  'question:select': (id: number) => void;
  'question:reject': (id: number) => void;
  'source:discover': (projectId: number, targetQuestion: string) => SourceRecommendation[];
  'source:adopt': (
    projectId: number,
    targetQuestion: string,
    source: SourceRecommendation,
  ) => void;
  'source:skip': (
    projectId: number,
    targetQuestion: string,
    source: SourceRecommendation,
  ) => void;
  'source:listDecisions': (
    projectId: number,
    targetQuestion: string,
  ) => SourceDecision[];
  'source:clearDecisions': (projectId: number, targetQuestion: string) => void;
  'source:removeDecision': (projectId: number, targetQuestion: string, url: string) => void;
  'title:generate': (projectId: number, targetQuestion: string) => TitleCandidate[];
  'article:generateRanking': (params: RankingArticleParams) => ArticleGenerateResult;

  // 窗口
  'window:minimize': () => void;
  'window:maximize': () => void;
  'window:unmaximize': () => void;
  'window:close': () => void;
  'window:isMaximized': () => boolean;
  'window:platform': () => NodeJS.Platform;

  // 用户设置（#37 登录信息进设置）
  'settings:get': () => UserSettings;
  'settings:set': (patch: Partial<UserSettings>) => UserSettings;
}
