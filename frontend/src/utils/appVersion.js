const CURRENT_VERSION = __APP_VERSION__;
const RELOAD_KEY = 'aprportal:last-version-reload';

async function checkAppVersion() {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
    });

    if (!response.ok) return;

    const data = await response.json();
    const serverVersion = data?.version;

    if (!serverVersion || serverVersion === CURRENT_VERSION) return;

    const lastReloadVersion = sessionStorage.getItem(RELOAD_KEY);
    if (lastReloadVersion === serverVersion) return;

    sessionStorage.setItem(RELOAD_KEY, serverVersion);
    window.location.reload();
  } catch (error) {
    console.warn('App version check failed:', error);
  }
}

export function startAppVersionCheck() {
  checkAppVersion();

  window.addEventListener('focus', checkAppVersion);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkAppVersion();
    }
  });
}
