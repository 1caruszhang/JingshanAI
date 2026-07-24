/**
 * #105: Integration tests for triggerAutoExtract — the auto fact-extraction
 * triggered after document upload.
 *
 * Coverage matrix (from acceptance criteria):
 *  - success on first attempt
 *  - failure on first attempt → retry after 2s → success
 *  - both attempts fail → onFailure invoked, no throw
 *
 * extract / delay / onFailure are injected so no IPC or timer is touched.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  triggerAutoExtract,
  AUTO_EXTRACT_RETRY_DELAY_MS,
  AUTO_EXTRACT_MAX_ATTEMPTS,
} from '../factAutoExtract';
import type { FactExtractionResult } from '../../types/domain';

const OK: FactExtractionResult = {
  extractedCount: 0,
  factIds: [],
  warnings: [],
  missingFields: [],
  riskWarnings: [],
};

/**
 * Build an extract stub from a list of outcomes. `true` = succeed, `false` =
 * throw on that call index. Calls beyond the list succeed.
 */
function makeExtract(
  outcomes: boolean[],
): (p: { projectId: number }) => Promise<FactExtractionResult> {
  let calls = 0;
  return async () => {
    const ok = outcomes[calls++] ?? true;
    if (!ok) throw new Error(`extract call ${calls} failed`);
    return OK;
  };
}

describe('triggerAutoExtract', () => {
  it('succeeds on first attempt without calling delay or onFailure', async () => {
    let extractCalls = 0;
    let delayCalls = 0;
    let failureCalls = 0;
    const result = await triggerAutoExtract(42, {
      extract: async () => {
        extractCalls++;
        return { ...OK, extractedCount: 3 };
      },
      delay: async () => {
        delayCalls++;
      },
      onFailure: () => {
        failureCalls++;
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.attempts, 1);
    assert.equal(extractCalls, 1);
    assert.equal(delayCalls, 0);
    assert.equal(failureCalls, 0);
  });

  it('retries once after 2s when first attempt fails, then succeeds', async () => {
    const extract = makeExtract([false, true]);
    const delays: number[] = [];
    let failureCalls = 0;

    const result = await triggerAutoExtract(7, {
      extract,
      delay: async (ms) => {
        delays.push(ms);
      },
      onFailure: () => {
        failureCalls++;
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.attempts, 2);
    assert.deepEqual(delays, [AUTO_EXTRACT_RETRY_DELAY_MS]);
    assert.equal(failureCalls, 0);
  });

  it('does not retry beyond the max attempts; invokes onFailure and does not throw', async () => {
    const extract = makeExtract([false, false]);
    const delays: number[] = [];
    const failures: string[] = [];

    const result = await triggerAutoExtract(1, {
      extract,
      delay: async (ms) => {
        delays.push(ms);
      },
      onFailure: (msg) => {
        failures.push(msg);
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.attempts, AUTO_EXTRACT_MAX_ATTEMPTS);
    // only one delay between the two attempts
    assert.deepEqual(delays, [AUTO_EXTRACT_RETRY_DELAY_MS]);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /自动抽取失败/);
  });
});
