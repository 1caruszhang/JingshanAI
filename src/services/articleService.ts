/**
 * articleService.ts
 * Thin renderer-side wrapper over articleApi, mirroring the factService /
 * draftService pattern so components depend on a service rather than the raw
 * IPC surface.
 */
import {articleApi} from '../lib/electron-api';
import type {SourceRecommendation} from '../types/domain';

export interface GenerateArticleParams {
  projectId: number;
  strategy: 'support_article';
  supportArticleType?: string;
  targetQuestion: string;
  title?: string;
  adoptedSources?: SourceRecommendation[];
}

export const articleService = {
  async generate(params: GenerateArticleParams) {
    return articleApi.generate(params);
  },

  async generateRanking(params: Parameters<typeof articleApi.generateRanking>[0]) {
    return articleApi.generateRanking(params);
  },

  async list(projectId: number) {
    return articleApi.list(projectId);
  },

  async get(artifactId: number) {
    return articleApi.get(artifactId);
  },

  async claimReview(artifactId: number) {
    return articleApi.claimReview(artifactId);
  },

  async geoReview(artifactId: number) {
    return articleApi.geoReview(artifactId);
  },

  async updateStatus(artifactId: number, status: Parameters<typeof articleApi.updateStatus>[1]) {
    return articleApi.updateStatus(artifactId, status);
  },

  async updateContent(artifactId: number, content: string) {
    return articleApi.updateContent(artifactId, content);
  },
};
