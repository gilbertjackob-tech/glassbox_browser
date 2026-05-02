export type StarterTarget = {
  targetKey: string;
  kind?: 'input' | 'button' | 'link' | 'card';
  selectors: string[];
  actions?: Array<'click' | 'type' | 'focus' | 'clear' | 'press'>;
  verify?: {
    urlChanged?: boolean;
    domChanged?: boolean;
    valueChanged?: boolean;
    focusConfirmed?: boolean;
    loadingStable?: boolean;
    urlIncludes?: string;
    titleIncludes?: string;
  };
};

export type StarterMicroSkill = {
  name: string;
  queryPattern?: string;
  steps: Array<{
    name?: string;
    targetKey: string;
    kind?: string;
    action: 'click' | 'type' | 'focus' | 'clear' | 'press';
    text?: string;
    key?: string;
    keys?: string[];
    clearFirst?: boolean;
    verify?: Record<string, unknown>;
  }>;
};

export type SiteStarterPack = {
  host: string;
  aliases?: string[];
  targets: StarterTarget[];
  microSkills?: StarterMicroSkill[];
};
