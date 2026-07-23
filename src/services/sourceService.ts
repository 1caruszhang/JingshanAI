/**
 * sourceService.ts
 * Thin renderer-side wrapper over sourceApi, mirroring the factService /
 * draftService pattern. Covers source discovery plus the adopt/skip decision
 * persistence that flows into article generation.
 */
import {sourceApi} from '../lib/electron-api';
import type {SourceDecision, SourceRecommendation} from '../types/domain';

export const sourceService = {
  async discover(projectId: number, targetQuestion: string): Promise<SourceRecommendation[]> {
    return sourceApi.discover(projectId, targetQuestion);
  },

  async adopt(projectId: number, targetQuestion: string, source: SourceRecommendation): Promise<void> {
    return sourceApi.adopt(projectId, targetQuestion, source);
  },

  async skip(projectId: number, targetQuestion: string, source: SourceRecommendation): Promise<void> {
    return sourceApi.skip(projectId, targetQuestion, source);
  },

  async listDecisions(projectId: number, targetQuestion: string): Promise<SourceDecision[]> {
    return sourceApi.listDecisions(projectId, targetQuestion);
  },

  async clearDecisions(projectId: number, targetQuestion: string): Promise<void> {
    return sourceApi.clearDecisions(projectId, targetQuestion);
  },

  async removeDecision(projectId: number, targetQuestion: string, url: string): Promise<void> {
    return sourceApi.removeDecision(projectId, targetQuestion, url);
  },
};
