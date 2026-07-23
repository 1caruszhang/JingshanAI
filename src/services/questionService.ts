/**
 * questionService.ts
 * Thin renderer-side wrapper over questionApi, mirroring the factService /
 * draftService pattern.
 */
import {questionApi} from '../lib/electron-api';

export const questionService = {
  async generate(projectId: number) {
    return questionApi.generate(projectId);
  },

  async list(projectId: number) {
    return questionApi.list(projectId);
  },

  async select(id: number) {
    return questionApi.select(id);
  },

  async reject(id: number) {
    return questionApi.reject(id);
  },
};
