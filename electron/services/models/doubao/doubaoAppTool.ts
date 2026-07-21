export type DoubaoAppFeature = 'chat' | 'deep_chat' | 'ai_search' | 'reasoning_search';

export type DoubaoAppTool = {
  type: 'doubao_app';
  feature: Record<
    DoubaoAppFeature,
    {type: 'enabled' | 'disabled'; role_description?: string}
  >;
  user_location?: {
    type: 'approximate';
    country?: string;
    region?: string;
    city?: string;
  };
};

export type DoubaoAppLocation = {
  country?: string;
  region?: string;
  city?: string;
};

const ALL_FEATURES: DoubaoAppFeature[] = ['chat', 'deep_chat', 'ai_search', 'reasoning_search'];

export function buildDoubaoAppTool(
  enabledFeature: DoubaoAppFeature,
  roleDescription?: string,
  location?: DoubaoAppLocation,
): DoubaoAppTool {
  const feature: DoubaoAppTool['feature'] = {
    chat: {type: 'disabled'},
    deep_chat: {type: 'disabled'},
    ai_search: {type: 'disabled'},
    reasoning_search: {type: 'disabled'},
  };

  feature[enabledFeature] = {
    type: 'enabled',
    role_description: roleDescription,
  };

  const tool: DoubaoAppTool = {
    type: 'doubao_app',
    feature,
  };

  const resolvedLocation = location ?? {
    country: process.env.DOUBAO_ASSISTANT_LOCATION_COUNTRY,
    region: process.env.DOUBAO_ASSISTANT_LOCATION_REGION,
    city: process.env.DOUBAO_ASSISTANT_LOCATION_CITY,
  };

  if (resolvedLocation.country || resolvedLocation.region || resolvedLocation.city) {
    tool.user_location = {
      type: 'approximate',
      ...resolvedLocation,
    };
  }

  return tool;
}

export function getDoubaoAssistantBetaHeader(): Record<string, string> {
  if (process.env.DOUBAO_ASSISTANT_BETA_HEADER === 'true') {
    return {'ark-beta-doubao-app': 'true'};
  }
  return {};
}

export function getDoubaoAssistantRoleDescription(): string | undefined {
  return process.env.DOUBAO_ASSISTANT_ROLE_DESCRIPTION;
}
