import { getSitePackForHost } from './sitePacks/index.js';

export async function resolveFromStarterPack(input: {
  tabUrl: string;
  runQuery: (selector: string) => Promise<any>;
  targetKey: string;
  kind?: string;
}) {
  const pack = getSitePackForHost(input.tabUrl);
  if (!pack) {
    return {
      found: false,
      reason: 'NO_SITE_PACK',
    };
  }

  const target = pack.targets.find((item) => item.targetKey === input.targetKey);
  if (!target) {
    return {
      found: false,
      reason: 'TARGET_NOT_IN_SITE_PACK',
      host: pack.host,
    };
  }

  if (input.kind && target.kind && input.kind !== target.kind) {
    return {
      found: false,
      reason: 'KIND_MISMATCH',
      host: pack.host,
      targetKey: input.targetKey,
    };
  }

  const attempts: any[] = [];

  for (const selector of target.selectors) {
    try {
      const result = await input.runQuery(selector);
      const element = result?.elements?.[0];

      attempts.push({
        selector,
        found: Boolean(element),
        visible: Boolean(element?.visible),
        enabled: Boolean(element?.interactable),
      });

      if (element?.visible && element?.interactable) {
        return {
          found: true,
          source: 'starter_pack',
          host: pack.host,
          targetKey: target.targetKey,
          target: {
            targetId: `starter_${target.targetKey}`,
            kind: target.kind || element.kind || input.kind || 'card',
            label: element.text || target.targetKey,
            selector,
            bbox: element.bbox,
            visible: element.visible,
            enabled: element.interactable,
            actions: target.actions || [],
            text: element.text || '',
          },
          starterTarget: target,
          attempts,
        };
      }
    } catch (error: any) {
      attempts.push({
        selector,
        error: error?.message || String(error),
      });
    }
  }

  return {
    found: false,
    reason: 'STARTER_PACK_TARGET_NOT_RESOLVED',
    host: pack.host,
    targetKey: input.targetKey,
    attempts,
  };
}
