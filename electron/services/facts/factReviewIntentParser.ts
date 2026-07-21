import type {FactReviewIntent, FactReviewAction} from '@/types/domain';

export interface ParseReviewIntentInput {
  text: string;
  facts: Array<{
    factId: number;
    displayIndex: number;
    factType: string;
    factValue: string;
  }>;
}

export function parseReviewIntent(input: ParseReviewIntentInput): FactReviewIntent {
  const text = input.text.trim();
  if (text.length === 0) {
    return {type: 'noop', actions: []};
  }

  const normalized = text
    .replace(/[，。！？、；：“”‘’（）【】《》]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // 全局指令
  if (/^(全部|所有|都)\s*确认/.test(normalized) || /确认\s*(全部|所有|都)/.test(normalized)) {
    return {
      type: 'confirm_all',
      actions: [{action: 'confirm', factIds: input.facts.map((f) => f.factId)}],
    };
  }
  if (/^(全部|所有|都)\s*拒绝/.test(normalized) || /拒绝\s*(全部|所有|都)/.test(normalized)) {
    return {
      type: 'reject_all',
      actions: [{action: 'reject', factIds: input.facts.map((f) => f.factId)}],
    };
  }

  const referencedIndices = new Set<number>();
  const actionsByFactId = new Map<number, FactReviewAction>();

  // 修改：第N条改成...
  const modifyPattern = /第\s*(\d+)\s*条\s*(?:改[成为]|修改[成为])\s*([^第]+?)(?=第\s*\d+\s*条|$)/g;
  for (const match of normalized.matchAll(modifyPattern)) {
    const idx = parseInt(match[1]!, 10);
    const rawValue = match[2]!.trim();
    const value = rawValue.replace(/^(?:为|成)\s*/, '').trim();
    const fact = findFactByDisplayIndex(input.facts, idx);
    if (fact && value) {
      referencedIndices.add(idx);
      actionsByFactId.set(fact.factId, {
        action: 'modify_and_confirm',
        factId: fact.factId,
        newFactValue: value,
      });
    }
  }

  // 确认/拒绝单条：第N条确认 / 第N条拒绝
  const singlePattern = /第\s*(\d+)\s*条\s*(确认|通过|要|拒绝|不要|删掉|删除)/g;
  for (const match of normalized.matchAll(singlePattern)) {
    const idx = parseInt(match[1]!, 10);
    const keyword = match[2]!;
    const fact = findFactByDisplayIndex(input.facts, idx);
    if (!fact || referencedIndices.has(idx)) continue;

    const isConfirm = /确认|通过|要/.test(keyword);
    const isReject = /拒绝|不要|删掉|删除/.test(keyword);
    if (!isConfirm && !isReject) continue;

    referencedIndices.add(idx);
    actionsByFactId.set(fact.factId, {
      action: isConfirm ? 'confirm' : 'reject',
      factIds: [fact.factId],
    });
  }

  // 其它/剩下的 确认/拒绝
  const restMatch = normalized.match(/(?:其它|其他|剩下|其余)\s*(?:事实|条目|的)?\s*(确认|拒绝)/);
  const restAction: FactReviewAction['action'] | null =
    restMatch?.[1] === '确认' ? 'confirm' : restMatch?.[1] === '拒绝' ? 'reject' : null;

  if (restAction) {
    const restIds = input.facts
      .filter((f) => !referencedIndices.has(f.displayIndex))
      .map((f) => f.factId);
    if (restIds.length > 0) {
      for (const id of restIds) {
        if (!actionsByFactId.has(id)) {
          actionsByFactId.set(id, {action: restAction, factIds: [id]});
        }
      }
    }
  }

  if (actionsByFactId.size === 0) {
    return {type: 'noop', actions: []};
  }

  const actions = Array.from(actionsByFactId.values());
  const type = determineIntentType(actions, input.facts.length);
  return {type, actions};
}

function findFactByDisplayIndex(
  facts: ParseReviewIntentInput['facts'],
  displayIndex: number,
) {
  return facts.find((f) => f.displayIndex === displayIndex);
}

function determineIntentType(
  actions: FactReviewAction[],
  totalFacts: number,
): FactReviewIntent['type'] {
  const confirmCount = actions.filter((a) => a.action === 'confirm').length;
  const rejectCount = actions.filter((a) => a.action === 'reject').length;
  const modifyCount = actions.filter((a) => a.action === 'modify_and_confirm').length;

  if (confirmCount === totalFacts && rejectCount === 0 && modifyCount === 0) return 'confirm_all';
  if (rejectCount === totalFacts && confirmCount === 0 && modifyCount === 0) return 'reject_all';
  if (modifyCount > 0) return 'modify_some';
  if (actions.length === confirmCount) return 'confirm_some';
  if (actions.length === rejectCount) return 'reject_all';
  return 'mixed';
}
