// scripts/testSimpleViews.js - Just test views extraction with your exact span
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

async function testViews(twitterUrl) {
    console.log('🔍 Simple Views Test');
    console.log('='.repeat(50));
    console.log(`URL: ${twitterUrl}`);
    
    // Extract tweet ID
    const tweetId = twitterUrl.match(/status\/(\d+)/)?.[1];
    if (!tweetId) {
        console.log('❌ Invalid Twitter URL');
        return;
    }
    
    console.log(`Tweet ID: ${tweetId}`);
    
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        
        const page = await browser.newPage();
        
        await page.goto(`https://twitter.com/i/status/${tweetId}`, { 
            waitUntil: 'domcontentloaded', 
            timeout: 30000 
        });
        
        console.log('✅ Page loaded, waiting 3 seconds...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Use your exact span
        const result = await page.evaluate(() => {
            const spans = document.querySelectorAll('span.css-1jxf684.r-bcqeeo.r-1ttztb7.r-qvutc0.r-poiln3');
            const found = [];
            
            spans.forEach((span, index) => {
                const text = span.textContent.trim();
                found.push({ index, text });
            });
            
            return found;
        });
        
        console.log(`\n📊 Found ${result.length} spans with your class:`);
        result.forEach(item => {
            console.log(`   ${item.index + 1}. "${item.text}"`);
        });
        
        // Find views
        const viewsSpan = result.find(item => item.text.includes('Views'));
        if (viewsSpan) {
            console.log(`\n✅ VIEWS FOUND: "${viewsSpan.text}"`);
            
            // Parse the number
            const number = viewsSpan.text.replace(/[^\d]/g, '');
            console.log(`📊 Parsed views: ${parseInt(number).toLocaleString()}`);
        } else {
            console.log('\n❌ No span containing "Views" found');
        }
        
    } catch (error) {
        console.log(`❌ Error: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Main
async function main() {
    const url = process.argv[2];
    
    if (!url) {
        console.log('Usage: node scripts/testSimpleViews.js TWITTER_URL');
        console.log('Example: node scripts/testSimpleViews.js https://x.com/blockchain/status/1928405664679760136');
        process.exit(1);
    }
    
    await testViews(url);
}

if (require.main === module) {
    main().catch(error => {
        console.error('Script failed:', error);
        process.exit(1);
    });
}