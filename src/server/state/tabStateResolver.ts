/**
 * Tab State Resolver
 *
 * Determines the readiness and diagnostic state of a tab:
 * - Is it loading?
 * - Is it authenticated?
 * - Is it on an auth/login page?
 * - Is the app ready (if SPA)?
 * - Are there errors or warnings?
 */

export interface TabReadinessInfo {
  isLoading: boolean;
  readyState: 'loading' | 'interactive' | 'complete' | 'app_ready' | 'unknown';
  loadingTimeMs?: number;
  isAuthPage: boolean;
  isLoggedIn: boolean | null; // null = unknown
  spaReady: boolean | null; // null = not an SPA or unknown
  errorIndicators: string[];
  warnings: string[];
  diagnosticSummary: string;
}

export async function getTabReadiness(tab: any): Promise<TabReadinessInfo> {
  const startMs = Date.now();
  const info: TabReadinessInfo = {
    isLoading: tab.webContents.isLoading?.() ?? false,
    readyState: 'unknown',
    isAuthPage: false,
    isLoggedIn: null,
    spaReady: null,
    errorIndicators: [],
    warnings: [],
    diagnosticSummary: '',
  };

  try {
    // Get document.readyState
    const readyState = await tab.webContents.executeJavaScript(
      'document.readyState'
    );
    info.readyState = readyState as any;

    // Check for SPA readiness
    const spaReady = await tab.webContents.executeJavaScript(`
      Boolean(
        window.__APP_READY__ ||
        document.querySelector('[data-reactroot], [data-react-root], #root.hydrated, .app-loaded') ||
        document.body.classList.contains('app-ready') ||
        document.documentElement.getAttribute('data-app-ready') === 'true'
      )
    `);
    info.spaReady = spaReady ?? null;

    // Check for login/auth indicators
    const isAuthPage = await tab.webContents.executeJavaScript(`
      Boolean(
        document.querySelector('input[type=password], .login-form, [class*=login], [class*=auth], .sign-in, .signin') ||
        document.body.innerText.toLowerCase().includes('sign in') ||
        document.body.innerText.toLowerCase().includes('login')
      )
    `);
    info.isAuthPage = isAuthPage ?? false;

    // Check if likely logged in
    const loggedInSignals = await tab.webContents.executeJavaScript(`
      Boolean(
        document.querySelector('[data-testid=HamburgerOpen], .logged-in, [class*=profile], .user-menu, .account') ||
        document.cookie.includes('auth') ||
        document.cookie.includes('session') ||
        document.cookie.includes('token')
      )
    `);
    info.isLoggedIn = loggedInSignals ?? null;

    // Check for error indicators
    const errorIndicators = await tab.webContents.executeJavaScript(`
      (function() {
        const errors = [];
        
        // Check for visible error messages
        const errorElements = document.querySelectorAll(
          '[class*=error], [class*=alert], [role=alert], .notification.error'
        );
        
        for (const el of errorElements) {
          if (el.offsetParent !== null) { // visible
            errors.push(el.innerText?.slice(0, 50) || 'error');
          }
        }
        
        // Check console errors (basic)
        if (window.__errors?.length > 0) {
          errors.push(\`console: \${window.__errors[0]}\`);
        }
        
        return errors;
      })()
    `);
    info.errorIndicators = errorIndicators ?? [];

    // Build diagnostic summary
    const parts: string[] = [];
    if (info.isLoading) parts.push('loading');
    if (info.isAuthPage) parts.push('auth-page');
    if (info.isLoggedIn === true) parts.push('logged-in');
    if (info.isLoggedIn === false) parts.push('not-logged-in');
    if (info.spaReady === true) parts.push('spa-ready');
    if (info.errorIndicators.length > 0) parts.push(`${info.errorIndicators.length}-errors`);

    info.diagnosticSummary = parts.join(', ') || 'unknown';
    info.loadingTimeMs = Date.now() - startMs;
  } catch (error) {
    info.warnings.push(`readiness check failed: ${String(error).slice(0, 50)}`);
  }

  return info;
}

export function canResumeTaskOnTab(readiness: TabReadinessInfo): boolean {
  // Can resume if:
  // - Not loading
  // - Not on auth page
  // - Either logged in, or login status unknown
  // - No critical errors

  if (readiness.isLoading) return false;
  if (readiness.isAuthPage) return false;
  if (readiness.isLoggedIn === false) return false; // Explicitly not logged in
  if (readiness.errorIndicators.length > 0) return false; // Has visible errors

  return true;
}

export function describeTabReadiness(readiness: TabReadinessInfo): string {
  const badge = (() => {
    if (readiness.isLoading) return '⏳';
    if (readiness.isAuthPage) return '🔐';
    if (readiness.isLoggedIn === true) return '✓';
    if (readiness.isLoggedIn === false) return '✗';
    return '❓';
  })();

  const parts = [
    `${badge} ${readiness.diagnosticSummary}`,
    `Ready: ${readiness.readyState === 'complete' || readiness.readyState === 'app_ready'}`,
  ];

  if (readiness.warnings.length > 0) {
    parts.push(`Warnings: ${readiness.warnings.join('; ')}`);
  }

  if (readiness.errorIndicators.length > 0) {
    parts.push(`Errors: ${readiness.errorIndicators.join('; ')}`);
  }

  return parts.join(' | ');
}
