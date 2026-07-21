export interface ToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
}

export function listTools(): ToolDefinition[] {
  return [];
}

export function getTool(_name: string): ToolDefinition | undefined {
  return undefined;
}
