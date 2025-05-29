// scripts/debugPumpfunApi.js - Debug the PumpFun API and puppeteer issues
require('dotenv').config();

async function debugPumpfunApi() {
    console.log('🔍 PumpFun API & Puppeteer Debug');
    console.log('='.repeat(50));
    
    const testToken = 'DDiP1d5aAjdKUCq1WrJGshk58TUFAkdmZ3zUXwAopump'; // Your failing token
    
    try {
        console.log('\n📋 Testing Direct API Calls (without puppeteer):');
        
        // Test 1: Direct HTTP request to PumpFun API
        const axios = require('axios');
        
        const testUrls = [
            `https://frontend-api-v3.pump.fun/trades/all/${testToken}?limit=1&offset=0&minimumSize=0`,
            `https://frontend-api-v3.pump.fun/trades/all/${testToken}?limit=200&offset=0&minimumSize=0`,
            `https://frontend-api-v3.pump.fun/trades/all/${testToken}?limit=200&offset=600&minimumSize=0`, // Your failing URL
            `https://frontend-api-v3.pump.fun/coins/${testToken}`
        ];
        
        for (const url of testUrls) {
            console.log(`\n🌐 Testing: ${url}`);
            try {
                const response = await axios.get(url, {
                    timeout: 10000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json',
                        'Referer': 'https://pump.fun/',
                        'Origin': 'https://pump.fun'
                    }
                });
                
                console.log(`   ✅ Status: ${response.status}`);
                console.log(`   ✅ Content-Type: ${response.headers['content-type']}`);
                console.log(`   ✅ Data type: ${typeof response.data}`);
                console.log(`   ✅ Data length: ${JSON.stringify(response.data).length} chars`);
                
                if (Array.isArray(response.data)) {
                    console.log(`   ✅ Array with ${response.data.length} items`);
                } else if (typeof response.data === 'object') {
                    console.log(`   ✅ Object with keys: ${Object.keys(response.data).join(', ')}`);
                }
                
            } catch (error) {
                console.log(`   ❌ Direct HTTP Error: ${error.message}`);
                if (error.response) {
                    console.log(`   ❌ Response status: ${error.response.status}`);
                    console.log(`   ❌ Response data: ${JSON.stringify(error.response.data).substring(0, 200)}`);
                }
            }
        }
        
        console.log('\n🤖 Testing PumpFun API Class:');
        
        const pumpfunApi = require('../src/integrations/pumpfunApi');
        
        // Test 2: Test your PumpFun API class
        try {
            console.log('\n🔍 Testing getAllTrades with limit 1...');
            const trades1 = await pumpfunApi.getAllTrades(testToken, 1, 0);
            console.log(`   ✅ Got ${Array.isArray(trades1) ? trades1.length : 'non-array'} trades`);
            
            console.log('\n🔍 Testing getAllTrades with limit 200, offset 0...');
            const trades200 = await pumpfunApi.getAllTrades(testToken, 200, 0);
            console.log(`   ✅ Got ${Array.isArray(trades200) ? trades200.length : 'non-array'} trades`);
            
            console.log('\n🔍 Testing getAllTrades with limit 200, offset 600 (your failing case)...');
            const trades600 = await pumpfunApi.getAllTrades(testToken, 200, 600);
            console.log(`   ✅ Got ${Array.isArray(trades600) ? trades600.length : 'non-array'} trades`);
            
        } catch (error) {
            console.log(`   ❌ PumpFun API Error: ${error.message}`);
            console.log(`   ❌ Stack: ${error.stack}`);
        }
        
        console.log('\n🎭 Testing Puppeteer Browser:');
        
        // Test 3: Test puppeteer directly
        const puppeteer = require('puppeteer-extra');
        const StealthPlugin = require('puppeteer-extra-plugin-stealth');
        puppeteer.use(StealthPlugin());
        
        let browser = null;
        try {
            console.log('🚀 Launching puppeteer browser...');
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-background-timer-throttling',
                    '--disable-renderer-backgrounding',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-plugins'
                ],
            });
            console.log('   ✅ Browser launched successfully');
            
            const page = await browser.newPage();
            console.log('   ✅ New page created');
            
            // Set user agent and headers
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            await page.setExtraHTTPHeaders({
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://pump.fun/',
                'Origin': 'https://pump.fun',
            });
            console.log('   ✅ Headers set');
            
            // Test navigation to the failing URL
            const failingUrl = `https://frontend-api-v3.pump.fun/trades/all/${testToken}?limit=200&offset=600&minimumSize=0`;
            console.log(`\n🔍 Testing navigation to: ${failingUrl}`);
            
            try {
                await page.goto(failingUrl, { 
                    waitUntil: 'domcontentloaded', 
                    timeout: 30000 
                });
                console.log('   ✅ Page loaded successfully');
                
                const bodyText = await page.evaluate(() => document.body.innerText);
                console.log(`   ✅ Body text length: ${bodyText.length} chars`);
                console.log(`   ✅ Body preview: ${bodyText.substring(0, 200)}...`);
                
                // Try to parse as JSON
                try {
                    const data = JSON.parse(bodyText);
                    console.log(`   ✅ JSON parsing successful`);
                    console.log(`   ✅ Data type: ${typeof data}`);
                    if (Array.isArray(data)) {
                        console.log(`   ✅ Array with ${data.length} items`);
                    }
                } catch (parseError) {
                    console.log(`   ❌ JSON parsing failed: ${parseError.message}`);
                    console.log(`   ❌ Raw content: ${bodyText.substring(0, 500)}`);
                }
                
            } catch (navError) {
                console.log(`   ❌ Navigation failed: ${navError.message}`);
            }
            
            await page.close();
            
        } catch (browserError) {
            console.log(`   ❌ Browser error: ${browserError.message}`);
        } finally {
            if (browser) {
                await browser.close();
                console.log('   ✅ Browser closed');
            }
        }
        
        console.log('\n🔍 Testing Different Tokens:');
        
        // Test 4: Try with different tokens to see if it's token-specific
        const testTokens = [
            'HBiqfjGvfVhXozbo2vG2gzsMKLUDZiZSJBYWWEtqx2rm', // Known working token
            '5w15NHf6u6c7hWPS2vs5ioVdG8WvHaf8CdFwmWpdpump', // Another known token
            testToken // Your failing token
        ];
        
        for (const token of testTokens) {
            console.log(`\n🎯 Testing token: ${token.substring(0, 8)}...`);
            try {
                const trades = await pumpfunApi.getAllTrades(token, 1, 0);
                console.log(`   ✅ Got ${Array.isArray(trades) ? trades.length : 'non-array'} trades`);
            } catch (error) {
                console.log(`   ❌ Failed: ${error.message}`);
            }
        }
        
        console.log('\n🔧 System Information:');
        console.log(`   Node.js version: ${process.version}`);
        console.log(`   Platform: ${process.platform}`);
        console.log(`   Architecture: ${process.arch}`);
        
        // Check puppeteer version
        try {
            const puppeteerVersion = require('puppeteer-extra/package.json').version;
            console.log(`   Puppeteer-extra version: ${puppeteerVersion}`);
        } catch (e) {
            console.log(`   Could not get puppeteer version`);
        }
        
        console.log('\n💡 Diagnosis Summary:');
        console.log('='.repeat(50));
        console.log('If direct HTTP requests work but puppeteer fails:');
        console.log('  - Puppeteer/browser issue or anti-bot detection');
        console.log('  - Try different user agents or browser args');
        console.log('');
        console.log('If both fail:');
        console.log('  - API endpoint changed or token-specific issue');
        console.log('  - Rate limiting or blocking');
        console.log('');
        console.log('If only offset=600 fails:');
        console.log('  - Token has less than 600 trades');
        console.log('  - API returns empty/invalid response for high offsets');
        
    } catch (error) {
        console.log(`❌ Fatal error: ${error.message}`);
        console.log(error.stack);
    }
}

// Test a simple puppeteer setup
async function testSimplePuppeteer() {
    console.log('\n🧪 Simple Puppeteer Test');
    console.log('='.repeat(30));
    
    const puppeteer = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());
    
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Test basic navigation
        console.log('🔍 Testing basic navigation...');
        await page.goto('https://httpbin.org/json', { waitUntil: 'domcontentloaded' });
        
        const content = await page.evaluate(() => document.body.innerText);
        console.log(`✅ Basic navigation works. Content: ${content.substring(0, 100)}...`);
        
        // Test JSON endpoint
        console.log('🔍 Testing JSON endpoint...');
        await page.goto('https://jsonplaceholder.typicode.com/posts/1', { waitUntil: 'domcontentloaded' });
        
        const jsonContent = await page.evaluate(() => document.body.innerText);
        console.log(`✅ JSON endpoint works. Content: ${jsonContent.substring(0, 100)}...`);
        
        // Try to parse the JSON
        try {
            const parsed = JSON.parse(jsonContent);
            console.log(`✅ JSON parsing works. Title: ${parsed.title}`);
        } catch (e) {
            console.log(`❌ JSON parsing failed: ${e.message}`);
        }
        
    } catch (error) {
        console.log(`❌ Simple puppeteer test failed: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--simple')) {
        await testSimplePuppeteer();
    } else {
        await debugPumpfunApi();
        
        if (args.includes('--simple-test')) {
            await testSimplePuppeteer();
        }
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('Script failed:', error);
        process.exit(1);
    });
}

module.exports = { debugPumpfunApi, testSimplePuppeteer };