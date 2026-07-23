/**
 * settingsService.ts
 *
 * 通用 key-value 用户设置存取（#37 登录信息进设置）。
 * 本轮仅 user_name；手机号/公司等留待真实账号体系。运行时可改即时生效。
 */

import {getDb} from '../db/connection.ts';
import type {UserSettings} from '@/types/domain';

/** 已知的设置 key 集合（强类型边界）。 */
const SETTING_KEYS = ['user_name'] as const;
type SettingKey = (typeof SETTING_KEYS)[number];

function getSetting(key: SettingKey): string {
  const db = getDb();
  const row = db
    .prepare('SELECT value FROM user_settings WHERE key = ?')
    .get(key) as {value: string} | undefined;
  return row?.value ?? '';
}

function setSetting(key: SettingKey, value: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO user_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, value);
}

/**
 * 读取全部用户设置，组装为 `UserSettings` 对象。
 */
export function getUserSettings(): UserSettings {
  return {
    userName: getSetting('user_name'),
  };
}

/**
 * 部分更新用户设置（仅传入字段生效，其余保持不变）。
 */
export function updateUserSettings(patch: Partial<UserSettings>): UserSettings {
  if (patch.userName !== undefined) {
    setSetting('user_name', patch.userName);
  }
  return getUserSettings();
}
