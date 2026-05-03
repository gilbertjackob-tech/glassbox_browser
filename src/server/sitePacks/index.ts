import { chatgptPack } from './chatgpt.js';
import { geminiPack } from './gemini.js';
import { githubPack } from './github.js';
import { googlePack } from './google.js';
import { whatsappPack } from './whatsapp.js';
import { youtubePack } from './youtube.js';
import type { SiteStarterPack } from './types.js';

const packs = [
  googlePack,
  youtubePack,
  githubPack,
  chatgptPack,
  geminiPack,
  whatsappPack,
];

export function normalizeHost(hostOrUrl: string) {
  try {
    const host = hostOrUrl.includes('://')
      ? new URL(hostOrUrl).hostname
      : hostOrUrl;

    return host.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(hostOrUrl || '').toLowerCase().replace(/^www\./, '');
  }
}

export function getSitePackForHost(hostOrUrl: string): SiteStarterPack | null {
  const host = normalizeHost(hostOrUrl);

  return packs.find((pack) => {
    const names = [pack.host, ...(pack.aliases || [])].map(normalizeHost);
    return names.includes(host);
  }) || null;
}

export function listSitePacks() {
  return packs.map((pack) => ({
    host: pack.host,
    aliases: pack.aliases || [],
    targetCount: pack.targets.length,
    microSkillCount: pack.microSkills?.length || 0,
    targets: pack.targets.map((target) => ({
      targetKey: target.targetKey,
      kind: target.kind,
      selectorCount: target.selectors.length,
      actions: target.actions || [],
    })),
    microSkills: (pack.microSkills || []).map((skill) => ({
      name: skill.name,
      queryPattern: skill.queryPattern,
      stepCount: skill.steps.length,
    })),
  }));
}
