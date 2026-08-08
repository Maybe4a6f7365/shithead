import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-gpu']
});
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2
});
const page = await ctx.newPage();
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/shots/lobby_pw.png' });
console.log('lobby shot OK');
// Click DEAL
await page.click('button:has-text("DEAL")');
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/shots/game_pw.png' });
console.log('game shot OK');
try {
  await page.click('button:has-text("READY")', { timeout: 3000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/shots/play_pw.png' });
  console.log('play shot OK');
} catch (e) { console.log('No ready button:', e.message); }

await browser.close();
console.log('done');
