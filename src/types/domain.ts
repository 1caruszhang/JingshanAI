// 视图路由
export type View =
  | 'dashboard'
  | 'aiAgent'
  | 'drafts'
  | 'autoLearning'
  | 'aiWebBuilder'
  | 'kbIngest'
  | 'kbCreate'
  | 'factReview'
  | 'enterpriseProfile'
  | 'questionPool'
  | 'sourceDiscovery'
  | 'articleGeneration'
  | 'humanReview';

// 通用状态枚举
export type TaskStatus =
  | 'created'
  | 'planning'
  | 'running'
  | 'waiting_user_input'
  | 'waiting_approval'
  | 'waiting_external_result'
  | 'paused'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type StepType =
  | 'plan'
  | 'tool_call'
  | 'skill_call'
  | 'subagent_call'
  | 'validation'
  | 'approval_request'
  | 'artifact_write'
  | 'retry'
  | 'recovery'
  | 'final_response';

export type PublishStatus = 'pending' | 'published' | 'failed';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type FactStatus = 'candidate' | 'confirmed' | 'rejected' | 'deprecated';
export type ChatRole = 'user' | 'assistant' | 'system';
export type ReflectionHypothesisStatus = 'candidate' | 'active' | 'degraded' | 'archived' | 'rejected';

// 知识库向量检索结果
export interface KnowledgeSearchResult {
  chunkId: number;
  distance?: number;
  chunkText: string;
  chunkIndex: number;
  entryId: number;
  entryTitle: string;
  sourceType: string | null;
  sourceFilePath: string | null;
}

// 索引结果
export interface IndexingResult {
  entryId: number;
  chunkCount: number;
  status: KnowledgeEntryStatus;
  error?: string;
}

// 项目
export interface Project {
  id: number;
  name: string;
  description: string | null;
  industry?: string | null;
  region?: string | null;
  domain?: 'local_service' | 'saas' | 'ecommerce' | null;
  status?: string | null;
  created_at: string;
  updated_at: string;
}

export type KnowledgeEntryStatus = 'pending' | 'indexed' | 'failed';

// 知识库原始条目
export interface KnowledgeEntry {
  id: number;
  project_id: number;
  title: string;
  content: string | null;
  source_type: string | null;
  source_file_path: string | null;
  metadata_json: string | null;
  status: KnowledgeEntryStatus;
  created_at: string;
}

// 知识库切片
export interface KnowledgeChunk {
  id: number;
  entry_id: number;
  chunk_text: string;
  chunk_index: number;
  content_hash: string | null;
  token_count: number | null;
  metadata_json: string | null;
  quality_score: number;
  created_at: string;
}

// 向量搜索结果
export interface VectorSearchResult {
  rowid: number;
  distance: number;
}

// 企业结构化事实
export interface EnterpriseFact {
  id: number;
  project_id: number;
  fact_type: string;
  fact_key: string;
  fact_value: string | null;
  confidence: number;
  source_entry_id: number | null;
  source_chunk_id: number | null;
  source_quote: string | null;
  extraction_model: string | null;
  extraction_prompt_version: string | null;
  status: FactStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_metadata_json: string | null;
  replaces_fact_id: number | null;
  extracted_json: string | null;
  created_at: string;
}

// 事实抽取输出（DeepSeek JSON Output）
export interface ExtractedFactCandidate {
  fact_type: string;
  fact_value: string;
  normalized_value?: string;
  source_chunk_id: number;
  source_quote: string;
  confidence: number;
  reasoning_note?: string;
}

// 事实审核意图
export type FactReviewAction =
  | {action: 'confirm'; factIds: number[]}
  | {action: 'reject'; factIds: number[]; reason?: string}
  | {action: 'modify_and_confirm'; factId: number; newFactValue: string; newFactType?: string}
  | {action: 'add_candidate'; factType?: string; factValue: string}
  | {action: 'noop'};

export interface FactReviewIntent {
  type: 'confirm_all' | 'reject_all' | 'confirm_some' | 'modify_some' | 'mixed' | 'noop';
  actions: FactReviewAction[];
}

// 聊天会话（公共会话，不绑定 project）
export interface ChatSession {
  id: number;
  title: string | null;
  session_type: string;
  created_at: string;
  updated_at?: string;
  last_provider_response_id?: string | null;
}

// 聊天消息（记录消息发生时的 project_id）
export interface ChatMessage {
  id: number;
  session_id: number;
  project_id: number | null;
  role: ChatRole;
  content: string;
  model: string | null;
  intent?: string | null;
  metadata_json?: string | null;
  render_json?: string | null;
  created_at: string;
}

// 会话摘要（长期记忆）
export interface ConversationSummary {
  id: number;
  session_id: number;
  project_id: number | null;
  summary_type: string;
  message_start_id: number | null;
  message_end_id: number | null;
  summary_json: string;
  token_estimate: number;
  model_provider: string | null;
  model_name: string | null;
  prompt_version: string | null;
  created_at: string;
  updated_at: string;
}

// 记忆事件审计日志
export interface MemoryEvent {
  id: number;
  memory_type: string;
  memory_table: string;
  memory_id: number;
  event_type: string;
  old_value_json: string | null;
  new_value_json: string | null;
  reason: string | null;
  actor: string;
  task_id: number | null;
  project_id: number | null;
  created_at: string;
}

// 文章产物元数据
export interface ArticleArtifactMeta {
  id: number;
  artifact_id: number;
  project_id: number;
  article_strategy_type: string;
  content_format: string | null;
  support_article_type: string | null;
  ranking_type: string | null;
  ranking_theme: string | null;
  target_question: string | null;
  title: string | null;
  title_score_json: string | null;
  applied_hypotheses_json: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

// 文章 Claim
export interface ArticleClaim {
  id: number;
  artifact_id: number;
  project_id: number;
  claim_text: string;
  claim_type: string;
  risk_level: string;
  review_status: string;
  created_at: string;
}

// Claim 来源
export interface ArticleClaimSource {
  id: number;
  claim_id: number;
  source_type: string;
  source_id: string;
  source_quote: string | null;
  confidence: number | null;
  created_at: string;
}

// 文章审核记录
export interface ArticleReview {
  id: number;
  artifact_id: number;
  project_id: number;
  review_type: string;
  reviewer: string;
  passed: number;
  score: number | null;
  review_json: string | null;
  risk_warnings_json: string | null;
  created_at: string;
}

// 文章生成结果
export interface ArticleGenerateResult {
  artifact: AgentArtifact;
  meta: ArticleArtifactMeta;
  claims: ArticleClaim[];
}

// Phase 7：问题池
export interface QuestionPoolItem {
  id: number;
  projectId: number;
  questionText: string;
  status: 'candidate' | 'selected' | 'rejected';
  score?: number;
  scoreReason?: string;
}

// Phase 7：信源推荐
export interface SourceRecommendation {
  url: string;
  title: string;
  relevanceReason: string;
}

// Phase 7：信源「采用 / 跳过」决策（持久化于 source_decisions 表）
export type SourceDecisionStatus = 'adopted' | 'skipped';

export interface SourceDecision {
  id: number;
  project_id: number;
  target_question: string;
  url: string;
  title: string | null;
  relevance_reason: string | null;
  decision: SourceDecisionStatus;
  created_at: string;
  updated_at: string;
}

// Phase 7：标题候选
export interface TitleCandidate {
  titleText: string;
  score: number;
  intent: string;
  notes?: string;
}

// Phase 7：排行榜文章生成参数
export interface RankingArticleParams {
  projectId: number;
  competitors: string[];
  targetQuestion: string;
}

// 排行榜上榜企业
export interface RankingArticleItem {
  id: number;
  artifact_id: number;
  project_id: number;
  rank: number;
  company_name: string;
  is_target_company: number;
  recommendation_reason: string;
  suitable_for_json: string | null;
  core_strengths_json: string | null;
  evidence_refs_json: string | null;
  risk_notes_json: string | null;
  created_at: string;
}

// 排行榜评选维度
export interface RankingCriterion {
  id: number;
  artifact_id: number;
  project_id: number;
  criterion_name: string;
  criterion_description: string | null;
  weight: number | null;
  required_evidence_json: string | null;
  created_at: string;
}

// 生成产物（稿件/报告/计划等）
export interface AgentArtifact {
  id: number;
  task_id: number | null;
  project_id: number;
  artifact_type: string;
  title: string | null;
  content: string | null;
  metadata_json: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

// 人工确认（Assistant Runtime 工具审批）
export interface ToolApproval {
  id: number;
  tool_call_id: number;
  requested_by: string;
  approval_type: string;
  status: ApprovalStatus;
  reviewer_note: string | null;
  requested_at: string;
  reviewed_at: string | null;
}

// 发布记录
export interface PublishRecord {
  id: number;
  artifact_id: number;
  project_id: number;
  channel_name: string;
  channel_type?: string | null;
  publish_title?: string | null;
  platform: string | null;
  status: PublishStatus;
  external_id?: string | null;
  published_url: string | null;
  estimated_price?: number | null;
  actual_price?: number | null;
  published_at?: string | null;
  created_at: string;
}

// 可见性检测
export interface VisibilityCheck {
  id: number;
  project_id?: number | null;
  artifact_id?: number | null;
  publish_record_id?: number | null;
  target_engine?: string | null;
  check_provider?: string | null;
  check_api_mode?: string | null;
  check_tool_type?: string | null;
  check_feature?: string | null;
  check_method?: string | null;
  provider_response_id?: string | null;
  query: string | null;
  published_url?: string | null;
  mentioned?: boolean;
  cited?: boolean;
  citation_urls_json?: string | null;
  answer_text?: string | null;
  search_summary?: string | null;
  matched_snippets_json?: string | null;
  confidence?: number | null;
  raw_response_json?: string | null;
  // v1.4.2 之前字段，保留兼容
  rank: number | null;
  response_text: string | null;
  matched: boolean;
  matched_url: string | null;
  matched_quote: string | null;
  checked_at: string;
}

// 模型调用日志
export interface ModelCallLog {
  id: number;
  run_id?: number | null;
  stage?: string | null;
  model: string | null;
  provider?: string | null;
  api_mode?: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  latency_ms?: number | null;
  cost_estimate?: number | null;
  status?: string | null;
  error_message?: string | null;
  provider_response_id?: string | null;
  previous_response_id?: string | null;
  provider_event_id?: string | null;
  skill_name?: string | null;
  prompt_version?: string | null;
  retry_count?: number;
  created_at: string;
}

// 应用配置
export interface AppSetting {
  key: string;
  value: string | null;
  updated_at: string;
}

// Assistant Runtime
export interface AssistantRun {
  id: number;
  session_id: number;
  project_id: number | null;
  request_id: string;
  run_type: string;
  status: string;
  current_step: string | null;
  provider: string | null;
  provider_api: string | null;
  provider_response_id: string | null;
  previous_response_id: string | null;
  input_json: string | null;
  output_json: string | null;
  error_id: number | null;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
}

export interface AssistantStreamEventRecord {
  id: number;
  session_id: number | null;
  message_id: number | null;
  run_id: number | null;
  request_id: string;
  event_type: string;
  event_json: string;
  created_at: string;
}

export interface AssistantToolCall {
  id: number;
  session_id: number | null;
  run_id: number | null;
  message_id: number | null;
  project_id: number | null;
  provider: string | null;
  provider_api: string | null;
  provider_tool_call_id: string | null;
  tool_name: string;
  tool_namespace: string | null;
  arguments_json: string | null;
  result_json: string | null;
  result_summary: string | null;
  status: string;
  approval_required: boolean;
  approval_id: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssistantQueueItem {
  id: number;
  session_id: number | null;
  run_id: number | null;
  parent_id: number | null;
  item_type: string;
  title: string;
  description: string | null;
  status: string;
  order_index: number;
  collapsible: boolean;
  collapsed: boolean;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssistantReasoningStep {
  id: number;
  session_id: number | null;
  run_id: number | null;
  message_id: number | null;
  title: string;
  content: string | null;
  status: string;
  order_index: number;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

// Agent-first Task Runtime
export interface AgentTask {
  id: number;
  session_id: number | null;
  project_id: number | null;
  title: string | null;
  user_goal: string;
  status: TaskStatus;
  current_objective: string | null;
  last_action: string | null;
  risk_level: string | null;
  allowed_actions_json: string | null;
  context_snapshot_json: string | null;
  budget_json: string | null;
  usage_json: string | null;
  failure_count: number;
  loop_count: number;
  max_loop_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface AgentTaskStep {
  id: number;
  task_id: number;
  parent_step_id: number | null;
  step_type: StepType;
  action_name: string | null;
  status: StepStatus;
  input_json: string | null;
  output_json: string | null;
  validation_json: string | null;
  error_id: number | null;
  attempt_count: number;
  max_attempts: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ExecutionLedgerEntry {
  id: number;
  task_id: number | null;
  step_id: number | null;
  project_id: number | null;
  actor: string;
  event_type: string;
  event_name: string | null;
  payload_json: string | null;
  created_at: string;
}

export interface AgentLock {
  id: number;
  lock_key: string;
  task_id: number;
  owner: string;
  expires_at: string;
  created_at: string;
}

export interface AgentFailure {
  id: number;
  task_id: number;
  step_id: number | null;
  error_type: string;
  message: string;
  context_json: string | null;
  created_at: string;
}

export interface AppError {
  id: number;
  error_code: string | null;
  error_type: string;
  message: string;
  stack_trace: string | null;
  context_json: string | null;
  recoverable: boolean;
  retryable: boolean;
  task_id: number | null;
  step_id: number | null;
  run_id: number | null;
  created_at: string;
}

export type GeoNextAction =
  | 'create_project'
  | 'ingest_knowledge'
  | 'search_knowledge'
  | 'extract_facts'
  | 'request_fact_review'
  | 'generate_questions'
  | 'recommend_sources'
  | 'generate_article'
  | 'review_article'
  | 'revise_article'
  | 'create_publish_plan'
  | 'request_publish_approval'
  | 'publish_article'
  | 'check_visibility'
  | 'generate_reflection_candidates'
  | 'request_hypothesis_review'
  | 'answer_user'
  | 'ask_user_for_missing_info'
  | 'summarize_task'
  | 'recover_from_error';

export interface AgentDecision {
  intent: string;
  current_objective: string;
  selected_action: GeoNextAction;
  reason: string;
  required_tools: string[];
  expected_artifacts: string[];
  risk_level: 'low' | 'medium' | 'high';
  requires_user_input: boolean;
  user_question?: string;
  completion_criteria: string[];
}

export interface GeoAgentContext {
  project?: Project;
  task?: AgentTask;
  userGoal: string;
  knowledgeState: {
    hasEntries: boolean;
    entryCount: number;
    chunkCount: number;
    vectorIndexStatus: 'ready' | 'missing' | 'needs_reindex' | 'building' | 'failed';
  };
  factState: {
    confirmedFactsCount: number;
    candidateFactsCount: number;
    missingFields: string[];
    needsReviewCount: number;
  };
  articleState: {
    hasDraft: boolean;
    draftStatus?: 'draft' | 'reviewing' | 'approved' | 'rejected';
    reviewPassed?: boolean;
    unsupportedClaimCount?: number;
  };
  publishState: {
    hasPublishPlan: boolean;
    publishApproved: boolean;
    published: boolean;
    publishRecordId?: number;
  };
  visibilityState: {
    checked: boolean;
    cited?: boolean;
    mentioned?: boolean;
    inconclusive?: boolean;
    lastCheckedAt?: string;
  };
  reflectionState: {
    candidateCount: number;
    activeCount: number;
    pendingReviewCount: number;
  };
  recentFailures: AgentFailure[];
  allowedActions: GeoNextAction[];
}

// Message Parts（用于 chat_messages.render_json 恢复）
export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'markdown'; content: string }
  | { type: 'attachment'; attachmentIds: number[] }
  | { type: 'tool_call'; toolCallId: number }
  | { type: 'approval_request'; approvalId: number }
  | { type: 'artifact'; artifactId: number; artifactType: string; title: string }
  | { type: 'sources'; evidencePackId: number }
  | { type: 'reasoning_steps'; stepIds: number[] }
  | { type: 'queue'; queueItemIds: number[] }
  | { type: 'error'; errorId: number };

// 反思假设系统（对应 reflection_hypotheses 表，含 013 迁移补充字段）
export interface ReflectionHypothesis {
  id: number;
  project_id: number | null;
  scope: string;
  industry: string | null;
  region: string | null;
  content_format: string | null;
  article_strategy_type: string | null;
  ranking_type: string | null;
  ranking_theme: string | null;

  // 旧字段保留兼容
  channel_name: string | null;
  target_stage: string;
  hypothesis_type: string;
  content: string;
  positive_examples: number;
  negative_examples: number;

  // 新字段（与开发文档 23.7 对齐）
  hypothesis_text: string | null;
  target_skill: string | null;
  target_engine: string | null;
  target_channel: string | null;
  applicable_conditions_json: string | null;
  excluded_conditions_json: string | null;
  recommended_action_json: string | null;
  positive_examples_json: string | null;
  negative_examples_json: string | null;
  inconclusive_examples_json: string | null;
  positive_count: number;
  negative_count: number;
  inconclusive_count: number;
  sample_size: number;
  evidence_project_count: number;
  evidence_industry_count: number;

  effect_score: number;
  confidence: number;
  validation_result_json: string | null;
  generated_by_model: string | null;
  validated_by_model: string | null;
  human_review_status: string;
  human_review_note: string | null;

  status: ReflectionHypothesisStatus;
  last_validated_at: string | null;
  decay_at: string | null;
  activated_at: string | null;
  degraded_at: string | null;
  archived_at: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReflectionHypothesisEvidence {
  id: number;
  hypothesis_id: number;
  project_id: number;
  artifact_id: number | null;
  visibility_check_id: number | null;
  evidence_type: string;
  evidence_json: string | null;
  created_at: string;
}

// 检索日志
export interface RetrievalLog {
  id: number;
  project_id: number;
  query: string;
  fact_hit_count: number;
  keyword_hit_count: number;
  vector_hit_count: number;
  selected_evidence_json: string | null;
  created_at: string;
}

// Evidence Pack
export interface KeywordHit {
  chunkId: number;
  entryId: number;
  entryTitle: string;
  chunkText: string;
  rank: number;
}

export interface VectorHit {
  chunkId: number;
  entryId: number;
  entryTitle: string;
  chunkText: string;
  distance: number;
}

export interface EvidencePack {
  projectId: number;
  query: string;
  facts: EnterpriseFact[];
  chunks: KnowledgeChunk[];
  keywordHits: KeywordHit[];
  vectorHits: VectorHit[];
  missingFields: string[];
  riskWarnings: string[];
}

// 领域聚合类型（供 UI 使用）
export interface KbHealthSummary {
  health: number;
  indexed: number;
  pending: number;
}

export interface DashboardStats {
  label: string;
  value: string;
  change?: string;
  trend?: 'up' | 'down';
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface ActionItem {
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  done: boolean;
}

export interface ActivityItem {
  id: string;
  title: string;
  time: string;
  type: string;
}

export interface KbAsset {
  name: string;
  status: 'indexed' | 'pending';
  words: number;
}

// Re-export fact ontology constants and types for use in Renderer
// factTypes.ts has no Node/Electron dependencies and is safe to import from either process,
// but all Renderer code should import via domain.ts to respect the architectural boundary.
export {
  FACT_TYPES,
  FACT_TYPE_LABELS,
  HIGH_RISK_FACT_TYPES,
  REQUIRED_FACT_TYPES_FOR_ARTICLE,
  isFactType,
} from '../../electron/services/facts/factTypes';
export type { FactType, FactExtractionResult } from '../../electron/services/facts/factTypes';

// Re-export AssistantStreamEvent for use in Renderer
// Renderer code must never import directly from electron/services/* — use this re-export.
export type { AssistantStreamEvent } from '../../electron/services/assistant/types';
