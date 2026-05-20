const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const userDataDir = path.join(process.env.HOME, '.local/share/yehthatrocks/facebook-magazine-browser-profile');
  const browserContext = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: ['--display=:0']
  });
  const page = await browserContext.newPage();
  try {
    // Navigate to Facebook Home or the group specifically
    console.log('Navigating to group...');
    await page.goto('https://www.facebook.com/groups/yehthatrocks/', { waitUntil: 'networkidle' });
    
    await page.waitForTimeout(5000);

    // Enumerate elements without trying to open composer first if it's hidden
    const elements = await page.evaluate(() => {
        const results = [];
        const candidates = document.querySelectorAll('button, [role="button"], [aria-label], span');
        const keywords = ['post', 'publish', 'share', 'create', 'write'];
        
        for (const el of candidates) {
            if (results.length >= 20) break;
            
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            
            const text = el.innerText || '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            
            const match = keywords.some(k => text.toLowerCase().includes(k) || ariaLabel.toLowerCase().includes(k));
            if (match) {
                results.push({
                    tagName: el.tagName,
                    role: el.getAttribute('role'),
                    ariaLabel: ariaLabel,
                    innerText: text.trim().substring(0, 50),
                    outerHTMLSnippet: el.outerHTML.substring(0, 100)
                });
            }
        }
        return results;
    });

    await page.screenshot({ path: '/tmp/magazine-facebook-post-debug.png' });
    const screenshotWritten = fs.existsSync('/tmp/magazine-facebook-post-debug.png');

    console.log(JSON.stringify({
        url: page.url(),
        elements,
        screenshotWritten
    }, null, 2));

  } catch (err) {
    console.error('Error during diagnostic:', err);
  } finally {
    await browserContext.close();
  }
})();
