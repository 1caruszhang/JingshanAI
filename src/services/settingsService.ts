import {settingsApi} from '../lib/electron-api';
import type {UserSettings} from '../types/domain';

export const settingsService = {
  async get(): Promise<UserSettings> {
    return settingsApi.get();
  },
  async update(patch: Partial<UserSettings>): Promise<UserSettings> {
    return settingsApi.set(patch);
  },
};
