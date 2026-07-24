/**
 * #105: 上传后自动触发事实抽取。
 *
 * `triggerAutoExtract(projectId)` 调用 `factApi.extract({ projectId })` 做一次全量
 * 抽取；失败后等待 2 秒重试一次。两次都失败时通过 `onFailure` 回调通知调用方
 * （默认实现弹 toast），不会抛出——抽取失败不影响已成功的上传结果。
 *
 * 抽取底层调用、延时与失败回调均可通过 `deps` 注入，便于在 node:test 下做
 * 集成测试（成功 / 失败一次后重试成功 / 两次均失败）。
 */
import { factApi } from '../lib/electron-api';
import { toast } from '../lib/toast';
import type { FactExtractionResult } from '../types/domain';

/** 重试前等待时长（毫秒）。 */
export const AUTO_EXTRACT_RETRY_DELAY_MS = 2000;
/** 最大尝试次数（含首次）。 */
export const AUTO_EXTRACT_MAX_ATTEMPTS = 2;

export interface TriggerAutoExtractDeps {
  /** 实际执行抽取的函数，默认走 `factApi.extract`。 */
  extract: (params: { projectId: number }) => Promise<FactExtractionResult>;
  /** 失败回调，默认弹 toast。调用方应注入本地化的失败文案。 */
  onFailure: (message: string) => void;
  /** 延时器，默认 `setTimeout`。 */
  delay: (ms: number) => Promise<void>;
}

export interface TriggerAutoExtractResult {
  success: boolean;
  attempts: number;
}

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 自动抽取企业事实，失败重试一次。
 *
 * @returns `{ success, attempts }` —— 不抛出，调用方无需 try/catch。
 */
export async function triggerAutoExtract(
  projectId: number,
  deps?: Partial<TriggerAutoExtractDeps>,
): Promise<TriggerAutoExtractResult> {
  const extract = deps?.extract ?? ((p) => factApi.extract(p));
  // 默认文案为中文兜底；调用方应通过 onFailure 注入本地化文案。
  const onFailure =
    deps?.onFailure ?? ((message) => toast.error(message));
  const delay = deps?.delay ?? defaultDelay;

  for (let attempt = 1; attempt <= AUTO_EXTRACT_MAX_ATTEMPTS; attempt++) {
    try {
      await extract({ projectId });
      return { success: true, attempts: attempt };
    } catch (err) {
      // 记录到控制台便于排查，但不向调用方抛出——抽取失败不影响上传结果。
      console.error(`[factAutoExtract] attempt ${attempt} failed for project ${projectId}:`, err);
      if (attempt < AUTO_EXTRACT_MAX_ATTEMPTS) {
        await delay(AUTO_EXTRACT_RETRY_DELAY_MS);
      }
    }
  }

  // 两次均失败——通知用户可手动重试，但不抛出。
  onFailure('自动抽取失败，可稍后手动重试');
  return { success: false, attempts: AUTO_EXTRACT_MAX_ATTEMPTS };
}
