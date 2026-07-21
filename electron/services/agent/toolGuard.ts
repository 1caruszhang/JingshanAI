export function evaluateToolRisk(_toolName: string, _args: unknown): 'low' | 'medium' | 'high' {
  return 'low';
}

export function requiresApproval(_toolName: string, _riskLevel: string): boolean {
  return false;
}
