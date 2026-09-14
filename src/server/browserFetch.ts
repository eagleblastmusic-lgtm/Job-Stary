import { chromium, type Browser } from 'playwright-core';

let sharedBrowser: Browser | null = null;
let browserClosingTimeout: NodeJS.Timeout | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserClosingTimeout) {
    clearTimeout(browserClosingTimeout);
    browserClosingTimeout = null;
  }
  if (sharedBrowser && sharedBrowser.isConnected()) {
    return sharedBrowser;
  }
  sharedBrowser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote'
    ]
  });
  return sharedBrowser;
}

function scheduleBrowserClose(): void {
  if (browserClosingTimeout) clearTimeout(browserClosingTimeout);
  browserClosingTimeout = setTimeout(async () => {
    if (sharedBrowser) {
      const b = sharedBrowser;
      sharedBrowser = null;
      await b.close().catch(() => {});
    }
  }, 30_000);
  browserClosingTimeout.unref();
}

export async function closeBrowser(): Promise<void> {
  if (browserClosingTimeout) {
    clearTimeout(browserClosingTimeout);
    browserClosingTimeout = null;
  }
  if (sharedBrowser) {
    const b = sharedBrowser;
    sharedBrowser = null;
    await b.close().catch(() => {});
  }
}

export async function browserFetch(url: string, timeoutMs = 25_000): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'pl-PL'
  });
  try {
    const page = await context.newPage();
    await page.addInitScript('Object.defineProperty(navigator, "webdriver", { get: () => undefined });');
    await page.goto(url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
    const content = await page.content();
    await page.close().catch(() => {});
    return content;
  } finally {
    await context.close().catch(() => {});
    scheduleBrowserClose();
  }
}
