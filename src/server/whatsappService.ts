import fs from 'node:fs';
import path from 'node:path';

export const STATIC_WHATSAPP_CHATS = [
  {
    name: 'Hasnat (You)',
    label: 'Hasnat (You)',
    isSelf: true,
  },
  {
    name: 'Bihi',
    label: 'Bihi',
    isSelf: false,
  },
  {
    name: 'আমাদের পরিবার',
    label: 'আমাদের পরিবার',
    isSelf: false,
  },
  {
    name: 'Tasfia New',
    label: 'Tasfia New',
    isSelf: false,
  },
  {
    name: 'Ammu',
    label: 'Ammu',
    isSelf: false,
  },
  {
    name: 'Abbu 2',
    label: 'Abbu 2',
    isSelf: false,
  },
] as const;

export function normalizeWhatsAppChatName(value: string) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function getStaticWhatsAppChat(chat: string) {
  const normalized = normalizeWhatsAppChatName(chat);
  return STATIC_WHATSAPP_CHATS.find(
    (item) => normalizeWhatsAppChatName(item.name).toLowerCase() === normalized.toLowerCase()
  ) || null;
}

export function listStaticWhatsAppChats() {
  return STATIC_WHATSAPP_CHATS;
}

export function assertKnownWhatsAppChat(chat: string) {
  const item = getStaticWhatsAppChat(chat);
  if (!item) {
    return {
      ok: false as const,
      reason: 'WHATSAPP_CHAT_NOT_IN_STATIC_LIST',
      chat,
      allowedChats: STATIC_WHATSAPP_CHATS.map((entry) => entry.name),
    };
  }

  return {
    ok: true as const,
    chat: item.name,
    item,
  };
}

export function assertCanSendToWhatsAppChat(input: {
  chat: string;
  allowExternalSend?: boolean;
}) {
  const known = assertKnownWhatsAppChat(input.chat);
  if (!known.ok) {
    return known;
  }

  if (known.item.isSelf) {
    return {
      ok: true as const,
      reason: 'SELF_CHAT_ALLOWED',
      chat: known.item.name,
      item: known.item,
    };
  }

  if (input.allowExternalSend === true) {
    return {
      ok: true as const,
      reason: 'EXTERNAL_SEND_EXPLICITLY_ALLOWED',
      chat: known.item.name,
      item: known.item,
    };
  }

  return {
    ok: false as const,
    reason: 'BLOCKED_EXTERNAL_SEND',
    chat: known.item.name,
    item: known.item,
  };
}

export function validateWhatsAppSendFilePath(filePath: string) {
  const resolved = path.resolve(String(filePath || ''));
  if (!fs.existsSync(resolved)) {
    throw new Error('FILE_NOT_FOUND');
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error('FILE_NOT_FILE');
  }

  const maxBytes = 100 * 1024 * 1024;
  if (stat.size > maxBytes) {
    throw new Error('FILE_TOO_LARGE');
  }

  return {
    path: resolved,
    sizeBytes: stat.size,
    name: path.basename(resolved),
  };
}

export function validateWhatsAppSendFilePaths(input: {
  filePath?: string;
  file?: string;
  filePaths?: string[];
}) {
  const rawFiles = [
    ...(Array.isArray(input.filePaths) ? input.filePaths : []),
    typeof input.filePath === 'string' ? input.filePath : '',
    typeof input.file === 'string' ? input.file : '',
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  const uniqueFiles = Array.from(new Set(rawFiles));
  if (uniqueFiles.length < 1) {
    throw new Error('WHATSAPP_FILE_REQUIRED');
  }

  const files = uniqueFiles.map((filePath) => validateWhatsAppSendFilePath(filePath));
  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const maxTotalBytes = 500 * 1024 * 1024;

  if (totalBytes > maxTotalBytes) {
    throw new Error('FILES_TOTAL_TOO_LARGE');
  }

  return {
    files,
    totalBytes,
  };
}
