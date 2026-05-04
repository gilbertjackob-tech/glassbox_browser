const API_BASE = process.env.GLASSBOX_API_BASE || process.env.GLASSBOX_API || 'http://127.0.0.1:3000';

async function requestJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}\n${JSON.stringify(data, null, 2)}`);
  }

  return data;
}

async function main() {
  const tabId = String(process.env.GLASSBOX_TEST_TAB_ID || '').trim();
  const singleFile = String(process.env.GLASSBOX_TEST_FILE || '').trim();
  const filesJson = String(process.env.GLASSBOX_TEST_FILES_JSON || '').trim();
  const chat = String(process.env.GLASSBOX_TEST_CHAT || 'Hasnat (You)').trim();
  const caption = String(process.env.GLASSBOX_TEST_CAPTION || 'test file from GlassBox').trim();

  const filePaths = [
    ...(singleFile ? [singleFile] : []),
    ...(filesJson ? JSON.parse(filesJson) : []),
  ].filter((item) => typeof item === 'string' && item.trim());

  if (filePaths.length < 1) {
    throw new Error('GLASSBOX_TEST_FILE_OR_FILES_JSON_REQUIRED');
  }

  const result = await requestJson(`${API_BASE}/api/whatsapp/send-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tabId,
      chat,
      filePath: filePaths[0],
      filePaths,
      caption,
      allowExternalSend: process.env.WHATSAPP_ALLOW_EXTERNAL_SEND === 'true',
    }),
  });

  console.log(JSON.stringify(result, null, 2));

  if (result.ok !== true) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
