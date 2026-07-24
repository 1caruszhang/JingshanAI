import {z} from 'zod';

export const DbQuerySchema = z.object({
  sql: z.string().min(1),
  params: z.array(z.unknown()).optional(),
});

export const DbExecSchema = z.object({
  sql: z.string().min(1),
  params: z.array(z.unknown()).optional(),
});

export type DbExecInput = z.infer<typeof DbExecSchema>;

export const KbIngestTextSchema = z.object({
  projectId: z.number().int().positive(),
  title: z.string().min(1),
  content: z.string().min(1),
});

export const KbIngestFileSchema = z.object({
  projectId: z.number().int().positive(),
  title: z.string().min(1),
  filePath: z.string().min(1),
});

export const KbIndexEntrySchema = z.object({
  entryId: z.number().int().positive(),
});

export const KbSearchSchema = z.object({
  projectId: z.number().int().positive(),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});

export const RagAskSchema = z.object({
  projectId: z.number().int().positive(),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});

export const VectorSearchSchema = z.object({
  table: z.string().min(1),
  queryVector: z.array(z.number()).min(1),
  limit: z.number().int().min(1).max(100).default(10),
});

export const OpenFileSchema = z.object({
  multiple: z.boolean().optional(),
  filters: z
    .array(
      z.object({
        name: z.string(),
        extensions: z.array(z.string()).min(1),
      }),
    )
    .optional(),
});

export const AppPathSchema = z.enum(['userData', 'home', 'downloads']);

// Project
export const ProjectCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  industry: z.string().optional(),
  region: z.string().optional(),
});

export const ProjectUpdateSchema = z.object({
  id: z.number().int().positive(),
  data: z.record(z.unknown()),
});

export const ProjectIdSchema = z.number().int().positive();

// Facts
export const KbFactsUpdateSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(['candidate', 'confirmed', 'rejected', 'deprecated']),
});

export const FactExtractSchema = z.object({
  projectId: z.number().int().positive(),
  entryId: z.number().int().positive().optional(),
  chunkIds: z.array(z.number().int().positive()).optional(),
  mode: z.enum(['ontology', 'free']).optional(),
  formInputs: z.record(z.string()).optional(),
});

export const FactListSchema = z.object({
  projectId: z.number().int().positive(),
  status: z.enum(['candidate', 'confirmed', 'rejected', 'deprecated']).optional(),
  factType: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

export const FactListPendingSchema = z.object({
  projectId: z.number().int().positive(),
  sessionId: z.number().int().positive().optional(),
});

export const FactConfirmSchema = z.object({
  factIds: z.array(z.number().int().positive()).min(1),
  reviewerNote: z.string().optional(),
});

export const FactRejectSchema = z.object({
  factIds: z.array(z.number().int().positive()).min(1),
  reviewerNote: z.string().optional(),
});

export const FactModifyAndConfirmSchema = z.object({
  factId: z.number().int().positive(),
  newFactValue: z.string().min(1),
  newFactType: z.string().optional(),
  reviewMessageId: z.number().int().positive().optional(),
});

export const FactMissingFieldsSchema = z.number().int().positive();

export const FactParseReviewIntentSchema = z.object({
  text: z.string().min(1),
  facts: z.array(
    z.object({
      factId: z.number().int().positive(),
      displayIndex: z.number().int().positive(),
      factType: z.string(),
      factValue: z.string(),
    }),
  ).min(1),
});

// Assistant
export const AssistantStreamStartSchema = z.object({
  sessionId: z.number().int().positive().optional(),
  projectId: z.number().int().positive().optional(),
  requestId: z.string().min(1),
  runType: z.string().optional(),
});

export const AssistantStreamCancelSchema = z.string().min(1);

export const AssistantHistorySchema = z.object({
  sessionId: z.number().int().positive(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const AssistantQueueListSchema = z.number().int().positive();

export const AssistantQueueUpdateSchema = z.object({
  itemId: z.number().int().positive(),
  status: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

// Tool approvals
export const ToolApprovalRespondSchema = z.object({
  approvalId: z.number().int().positive(),
  approved: z.boolean(),
  note: z.string().optional(),
});

// Agent tasks
export const AgentTaskCreateSchema = z.object({
  sessionId: z.number().int().positive().optional(),
  projectId: z.number().int().positive().optional(),
  title: z.string().optional(),
  userGoal: z.string().min(1),
});

// #90: AgentTaskRun 在 AgentTaskCreate 基础上新增 files 字段
export const AgentTaskRunSchema = z.object({
  sessionId: z.number().int().positive().optional(),
  projectId: z.number().int().positive().optional(),
  title: z.string().optional(),
  userGoal: z.string().min(1),
  files: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.string(),
        bytes: z.number().int().positive(),
        content: z.string().optional(),
      }),
    )
    .optional(),
});

export const AgentTaskIdSchema = z.number().int().positive();

export const AgentTaskListSchema = z.object({
  projectId: z.number().int().positive().optional(),
  status: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

// #77: resume 时传入 taskId 及可选的 resumeValue
export const AgentTaskResumeSchema = z.object({
  taskId: z.number().int().positive(),
  resumeValue: z.unknown().optional(),
});

// #79: HITL interrupt response with structured decisions
export const AgentTaskInterruptRespondSchema = z.object({
  taskId: z.number().int().positive(),
  decisions: z.array(
    z.object({
      toolName: z.string().min(1),
      decision: z.enum(['approve', 'reject']),
      reason: z.string().optional(),
    }),
  ),
});

// Drafts / artifacts
export const DraftListSchema = z.number().int().positive();

export const DraftGetSchema = z.number().int().positive();

export const DraftUpdateSchema = z.object({
  id: z.number().int().positive(),
  content: z.string(),
  status: z.string().optional(),
});

export const DraftReviewSchema = z.object({
  id: z.number().int().positive(),
  approved: z.boolean(),
  note: z.string().optional(),
});

// Publish
export const PublishPlanSchema = z.object({
  artifactId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  channels: z.array(
    z.object({
      name: z.string().min(1),
      platform: z.string().min(1),
      channelType: z.string().optional(),
    }),
  ),
});

export const PublishApproveSchema = z.object({
  publishRecordIds: z.array(z.number().int().positive()),
  approved: z.boolean(),
});

export const PublishStatusSchema = z.number().int().positive();

// Visibility
export const VisibilityCheckSchema = z.object({
  publishRecordId: z.number().int().positive(),
  query: z.string().optional(),
});

// Reflection
export const ReflectionListSchema = z.object({
  status: z.string().optional(),
  scope: z.string().optional(),
});

export const ReflectionIdSchema = z.number().int().positive();

// Article
// Phase 7：信源推荐对象（article:generate 的 adoptedSources 与 source:* 决策共用）
const SourceRecommendationSchema = z.object({
  url: z.string().min(1),
  title: z.string(),
  relevanceReason: z.string(),
});

export const ArticleGenerateSchema = z.object({
  projectId: z.number().int().positive(),
  strategy: z.literal('support_article'),
  supportArticleType: z.string().optional(),
  targetQuestion: z.string().min(1),
  title: z.string().optional(),
  adoptedSources: z.array(SourceRecommendationSchema).optional(),
});

export const ArticleIdSchema = z.number().int().positive();

export const ArticleStatusSchema = z.enum([
  'draft',
  'claim_reviewed',
  'geo_reviewed',
  'approved',
  'rejected',
]);

export const ArticleUpdateContentSchema = z.object({
  artifactId: z.number().int().positive(),
  content: z.string(),
});

// Phase 7：问题池、信源发现、标题生成、排行榜文章
export const QuestionGenerateSchema = z.number().int().positive();
export const QuestionListSchema = z.number().int().positive();
export const QuestionSelectSchema = z.number().int().positive();
export const QuestionRejectSchema = z.number().int().positive();

export const ProjectQuestionSchema = z.object({
  projectId: z.number().int().positive(),
  targetQuestion: z.string().min(1),
});

export const SourceDiscoverSchema = ProjectQuestionSchema;

// Phase 7：信源「采用 / 跳过」决策持久化（SourceRecommendationSchema 见上）
export const SourceAdoptSchema = z.object({
  projectId: z.number().int().positive(),
  targetQuestion: z.string().min(1),
  source: SourceRecommendationSchema,
});

export const SourceSkipSchema = SourceAdoptSchema;

export const SourceListDecisionsSchema = ProjectQuestionSchema;
export const SourceClearDecisionsSchema = ProjectQuestionSchema;

export const SourceRemoveDecisionSchema = z.object({
  projectId: z.number().int().positive(),
  targetQuestion: z.string().min(1),
  url: z.string().min(1),
});
export const TitleGenerateSchema = ProjectQuestionSchema;

export const ArticleGenerateRankingSchema = z.object({
  projectId: z.number().int().positive(),
  competitors: z.array(z.string()),
  targetQuestion: z.string().min(1),
});

// 用户设置（#37 登录信息进设置）
export const SettingsUpdateSchema = z.object({
  userName: z.string().optional(),
});
