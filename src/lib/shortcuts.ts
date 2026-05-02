export type ShortcutCommand =
  | 'focus_address_bar'
  | 'navigate_current_input'
  | 'browser_back'
  | 'browser_forward'
  | 'reload_tab'
  | 'hard_reload_tab'
  | 'escape_or_stop'
  | 'new_tab'
  | 'close_tab'
  | 'reopen_tab'
  | 'next_tab'
  | 'previous_tab'
  | 'switch_tab_index'
  | 'switch_last_tab'
  | 'open_profile_switcher'
  | 'settings_profiles'
  | 'detect_profile_email'
  | 'settings_backup'
  | 'create_profile'
  | 'switch_default_profile'
  | 'open_settings'
  | 'settings_appearance'
  | 'settings_search'
  | 'settings_privacy'
  | 'settings_automation'
  | 'settings_shortcuts'
  | 'settings_about'
  | 'toggle_memory_panel'
  | 'toggle_history_panel'
  | 'toggle_downloads_panel'
  | 'toggle_dom_panel'
  | 'toggle_logs_panel'
  | 'settings_utility'
  | 'capture_dom'
  | 'capture_html'
  | 'capture_screenshot'
  | 'capture_a11y'
  | 'query_selector'
  | 'inspect_cursor'
  | 'copy_selector'
  | 'verify_last_action'
  | 'retry_failed_action'
  | 'show_latest_log'
  | 'panic_stop'
  | 'toggle_automation_pause'
  | 'cancel_action_queue'
  | 'undo_last_safe_action'
  | 'open_command_palette';

export type ShortcutGroup =
  | 'Navigation'
  | 'Tabs'
  | 'Profiles'
  | 'Settings'
  | 'Utility Panels'
  | 'Automation'
  | 'Safety'
  | 'Command';

export interface ShortcutDefinition {
  id: string;
  command: ShortcutCommand;
  keys: string;
  label: string;
  group: ShortcutGroup;
  cli: string;
  payload?: Record<string, unknown>;
}

export interface ShortcutConflict {
  keys: string;
  definitions: ShortcutDefinition[];
}

const SPECIAL_KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  ',': ',',
  Escape: 'Esc',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Tab: 'Tab',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
};

function createShortcut(
  id: string,
  command: ShortcutCommand,
  keys: string,
  label: string,
  group: ShortcutGroup,
  cli: string,
  payload?: Record<string, unknown>,
): ShortcutDefinition {
  return {
    id,
    command,
    keys: formatShortcut(keys),
    label,
    group,
    cli,
    payload,
  };
}

const tabIndexShortcuts = Array.from({ length: 8 }, (_, index) => {
  const tabNumber = index + 1;
  return createShortcut(
    `tabs-switch-${tabNumber}`,
    'switch_tab_index',
    `Alt+${tabNumber}`,
    `Switch to tab ${tabNumber}`,
    'Tabs',
    `gb tab use ${tabNumber}`,
    { index },
  );
});

export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  createShortcut('nav-focus-address-primary', 'focus_address_bar', 'Ctrl+L', 'Focus address bar', 'Navigation', 'gb focus address'),
  createShortcut('nav-focus-address-secondary', 'focus_address_bar', 'Ctrl+K', 'Focus search/address bar', 'Navigation', 'gb focus address'),
  createShortcut('nav-go', 'navigate_current_input', 'Enter', 'Go or search', 'Navigation', 'gb nav "<input>"'),
  createShortcut('nav-back', 'browser_back', 'Alt+Left', 'Back', 'Navigation', 'gb back'),
  createShortcut('nav-forward', 'browser_forward', 'Alt+Right', 'Forward', 'Navigation', 'gb forward'),
  createShortcut('nav-reload', 'reload_tab', 'Ctrl+R', 'Reload current tab', 'Navigation', 'gb reload'),
  createShortcut('nav-hard-reload', 'hard_reload_tab', 'Ctrl+Shift+R', 'Hard reload current tab', 'Navigation', 'gb reload --hard'),
  createShortcut('nav-escape', 'escape_or_stop', 'Esc', 'Stop loading or close overlay', 'Navigation', 'gb stop'),

  createShortcut('tabs-new', 'new_tab', 'Ctrl+T', 'New tab', 'Tabs', 'gb tab new'),
  createShortcut('tabs-close', 'close_tab', 'Ctrl+W', 'Close tab', 'Tabs', 'gb tab close'),
  createShortcut('tabs-reopen', 'reopen_tab', 'Ctrl+Shift+T', 'Reopen closed tab', 'Tabs', 'gb tab reopen'),
  createShortcut('tabs-next', 'next_tab', 'Ctrl+Tab', 'Next tab', 'Tabs', 'gb tab next'),
  createShortcut('tabs-prev', 'previous_tab', 'Ctrl+Shift+Tab', 'Previous tab', 'Tabs', 'gb tab prev'),
  ...tabIndexShortcuts,
  createShortcut('tabs-last', 'switch_last_tab', 'Alt+9', 'Switch to last tab', 'Tabs', 'gb tab last'),

  createShortcut('profiles-switcher', 'open_profile_switcher', 'Ctrl+Shift+P', 'Open profile switcher', 'Profiles', 'gb profile list'),
  createShortcut('profiles-settings', 'settings_profiles', 'Ctrl+Alt+P', 'Open profiles settings', 'Profiles', 'gb settings profiles'),
  createShortcut('profiles-detect-email', 'detect_profile_email', 'Ctrl+Alt+E', 'Detect active profile email', 'Profiles', 'gb profile detect-email'),
  createShortcut('profiles-backup', 'settings_backup', 'Ctrl+Alt+B', 'Open backup and restore', 'Profiles', 'gb profile backup'),
  createShortcut('profiles-create', 'create_profile', 'Ctrl+Alt+N', 'Create new profile', 'Profiles', 'gb profile new'),
  createShortcut('profiles-default', 'switch_default_profile', 'Ctrl+Alt+0', 'Switch to default profile', 'Profiles', 'gb profile use default'),

  createShortcut('settings-open', 'open_settings', 'Ctrl+,', 'Open settings', 'Settings', 'gb settings'),
  createShortcut('settings-profiles', 'settings_profiles', 'Ctrl+Alt+1', 'Settings: Profiles', 'Settings', 'gb settings profiles'),
  createShortcut('settings-backup', 'settings_backup', 'Ctrl+Alt+2', 'Settings: Backup and Restore', 'Settings', 'gb settings backup'),
  createShortcut('settings-appearance', 'settings_appearance', 'Ctrl+Alt+3', 'Settings: Appearance', 'Settings', 'gb settings appearance'),
  createShortcut('settings-search', 'settings_search', 'Ctrl+Alt+4', 'Settings: Search Engine', 'Settings', 'gb settings search'),
  createShortcut('settings-privacy', 'settings_privacy', 'Ctrl+Alt+5', 'Settings: Privacy and Data', 'Settings', 'gb settings privacy'),
  createShortcut('settings-automation', 'settings_automation', 'Ctrl+Alt+6', 'Settings: Automation', 'Settings', 'gb settings automation'),
  createShortcut('settings-shortcuts', 'settings_shortcuts', 'Ctrl+Alt+7', 'Settings: Keyboard Shortcuts', 'Settings', 'gb settings shortcuts'),
  createShortcut('settings-about', 'settings_about', 'Ctrl+Alt+8', 'Settings: About', 'Settings', 'gb settings about'),

  createShortcut('utility-memory', 'toggle_memory_panel', 'Ctrl+Shift+M', 'Toggle memory search panel', 'Utility Panels', 'gb panel memory'),
  createShortcut('utility-history', 'toggle_history_panel', 'Ctrl+Shift+H', 'Toggle history panel', 'Utility Panels', 'gb panel history'),
  createShortcut('utility-downloads', 'toggle_downloads_panel', 'Ctrl+Shift+J', 'Toggle downloads panel', 'Utility Panels', 'gb panel downloads'),
  createShortcut('utility-dom', 'toggle_dom_panel', 'Ctrl+Shift+O', 'Toggle DOM snapshot panel', 'Utility Panels', 'gb panel dom'),
  createShortcut('utility-logs', 'toggle_logs_panel', 'Ctrl+Shift+A', 'Toggle activity log panel', 'Utility Panels', 'gb panel logs'),
  createShortcut('utility-settings', 'settings_utility', 'Ctrl+Shift+U', 'Open utility panel settings', 'Utility Panels', 'gb settings utility'),

  createShortcut('automation-dom', 'capture_dom', 'Ctrl+Alt+D', 'Capture DOM snapshot', 'Automation', 'gb dom'),
  createShortcut('automation-html', 'capture_html', 'Ctrl+Alt+H', 'Capture full HTML', 'Automation', 'gb html'),
  createShortcut('automation-screenshot', 'capture_screenshot', 'Ctrl+Alt+S', 'Capture screenshot', 'Automation', 'gb screenshot'),
  createShortcut('automation-a11y', 'capture_a11y', 'Ctrl+Alt+A', 'Capture accessibility tree', 'Automation', 'gb a11y'),
  createShortcut('automation-query', 'query_selector', 'Ctrl+Alt+Q', 'Query selector', 'Automation', 'gb query "<selector>"'),
  createShortcut('automation-inspect-cursor', 'inspect_cursor', 'Ctrl+Alt+X', 'Inspect cursor element', 'Automation', 'gb inspect cursor'),
  createShortcut('automation-copy-selector', 'copy_selector', 'Ctrl+Alt+C', 'Copy selector', 'Automation', 'gb selector copy'),
  createShortcut('automation-verify', 'verify_last_action', 'Ctrl+Alt+V', 'Verify last action', 'Automation', 'gb verify'),
  createShortcut('automation-retry', 'retry_failed_action', 'Ctrl+Alt+R', 'Retry failed action', 'Automation', 'gb retry'),
  createShortcut('automation-latest-log', 'show_latest_log', 'Ctrl+Alt+L', 'Open latest action log', 'Automation', 'gb logs latest'),

  createShortcut('safety-panic', 'panic_stop', 'Ctrl+Alt+Esc', 'Panic stop automation', 'Safety', 'gb stop --panic'),
  createShortcut('safety-pause', 'toggle_automation_pause', 'Ctrl+Alt+Space', 'Pause or resume automation', 'Safety', 'gb pause'),
  createShortcut('safety-clear-queue', 'cancel_action_queue', 'Ctrl+Alt+Backspace', 'Cancel queued actions', 'Safety', 'gb queue clear'),
  createShortcut('safety-undo', 'undo_last_safe_action', 'Ctrl+Alt+Z', 'Undo last safe action', 'Safety', 'gb undo'),

  createShortcut('command-palette', 'open_command_palette', 'Ctrl+Shift+K', 'Open command palette', 'Command', 'gb commands'),
];

export function formatShortcut(input: string) {
  const parts = input
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return '';

  const modifiers = new Set<string>();
  let key = '';

  for (const part of parts) {
    const lowered = part.toLowerCase();
    if (lowered === 'ctrl' || lowered === 'control') {
      modifiers.add('Ctrl');
    } else if (lowered === 'alt' || lowered === 'option') {
      modifiers.add('Alt');
    } else if (lowered === 'shift') {
      modifiers.add('Shift');
    } else if (lowered === 'meta' || lowered === 'cmd' || lowered === 'command') {
      modifiers.add('Meta');
    } else {
      key = SPECIAL_KEY_LABELS[part] || SPECIAL_KEY_LABELS[part[0]?.toUpperCase() + part.slice(1)] || (part.length === 1 ? part.toUpperCase() : part);
    }
  }

  const orderedModifiers = ['Ctrl', 'Alt', 'Shift', 'Meta'].filter((modifier) => modifiers.has(modifier));
  return [...orderedModifiers, key].filter(Boolean).join('+');
}

function normalizeEventKey(eventKey: string) {
  if (SPECIAL_KEY_LABELS[eventKey]) {
    return SPECIAL_KEY_LABELS[eventKey];
  }

  if (eventKey.length === 1) {
    return eventKey.toUpperCase();
  }

  return eventKey;
}

export function parseShortcutEvent(event: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'key'>) {
  const parts: string[] = [];

  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');

  const key = normalizeEventKey(event.key);
  if (!key) return '';

  parts.push(key);
  return formatShortcut(parts.join('+'));
}

export function detectShortcutConflicts(definitions: ShortcutDefinition[]) {
  const grouped = new Map<string, ShortcutDefinition[]>();

  for (const definition of definitions) {
    if (!definition.keys) continue;
    const normalized = formatShortcut(definition.keys);
    if (!normalized) continue;
    const bucket = grouped.get(normalized) || [];
    bucket.push({ ...definition, keys: normalized });
    grouped.set(normalized, bucket);
  }

  return Array.from(grouped.entries())
    .filter(([, items]) => items.length > 1)
    .map(([keys, items]) => ({ keys, definitions: items as ShortcutDefinition[] }));
}
