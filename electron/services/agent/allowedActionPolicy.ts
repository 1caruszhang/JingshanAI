import type {GeoNextAction} from '@/types/domain';

export function getAllowedActions(_context: unknown): GeoNextAction[] {
  return [];
}

export function isActionAllowed(_action: GeoNextAction, _context: unknown): boolean {
  return false;
}
