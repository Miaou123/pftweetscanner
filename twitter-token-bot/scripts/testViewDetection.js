// scripts/testViewDetection.js - Debug view extraction specifically
require('dotenv').config();

async function testViewDetection() {
    console.log('🔍 View Detection Debug Test');
    console.log('='.repeat(50));
    
    // Test URLs - mix of known working and your failing case
    const testUrls = [
        // Your token's Twitter URL that failed
        'https://x.com/kasinglung/status/697464020564099072',
        
        // Some other test URLs (you can add more)
        'https://twitter.com/elonmusk/status/1870185670043955393', // Usually has high views
        'https://x.com/pumpdotfun/status/1870000000000000000', // PumpFun official
        'https://twitter.com/solana/status/1869000000000000000', // Solana official
        
        // Add any specific URLs you want to test
    ];
    
    const TwitterValidator = require('../src/validators/twitterValidator');
    
    // Test different configurations
    const configs = [
        {
            name: 'Default Config (Page Extraction Enabled)',
            config: { enablePageExtraction: true, timeout: 30000, quickTimeout: 5000 }
        },
        {
            name: 'Extended Timeout',
            config: { enablePageExtraction: true, timeout: 60000, quickTimeout: 10000 }
        },
        {
            name: 'Page Extraction Disabled (Likes Only)',
            config: { enablePageExtraction: false, quickTimeout: 5000 }
        }
    ];
    
    for (const configTest of configs) {
        console.log(`\n🧪 Testing: ${configTest.name}`);
        console.log('─'.repeat(60));
        
        const validator = new TwitterValidator(configTest.config);
        
        for (const url of testUrls) {
            console.log(`\n🔍 Testing URL: ${url}`);
            
            try {
                // Step 1: Extract tweet ID
                const tweetId = validator.extractTweetId(url);
                if (!tweetId) {
                    console.log('❌ Could not extract tweet ID');
                    continue;
                }
                console.log(`✅ Tweet ID: ${tweetId}`);
                
                // Step 2: Quick likes check
                console.log('⚡ Testing quick likes check...');
                const quickStart = Date.now();
                const quickMetrics = await validator.quickLikesCheck(url);
                const quickTime = Date.now() - quickStart;
                
                if (quickMetrics && quickMetrics.likes > 0) {
                    console.log(`✅ Quick likes (${quickTime}ms): ${quickMetrics.likes} likes`);
                } else {
                    console.log(`❌ Quick likes failed (${quickTime}ms)`);
                    console.log(`   Result:`, quickMetrics);
                    continue; // Skip view test if likes fail
                }
                
                // Step 3: Full validation (includes view extraction if enabled)
                if (configTest.config.enablePageExtraction) {
                    console.log('👀 Testing view extraction...');
                    const viewStart = Date.now();
                    const fullMetrics = await validator.validateEngagement(url);
                    const viewTime = Date.now() - viewStart;
                    
                    if (fullMetrics) {
                        console.log(`✅ Full validation (${viewTime}ms):`);
                        console.log(`   Views: ${fullMetrics.views || 0}`);
                        console.log(`   Likes: ${fullMetrics.likes || 0}`);
                        console.log(`   Published: ${fullMetrics.publishedAt || 'N/A'}`);
                        
                        // Compare results
                        if (fullMetrics.views > 0) {
                            console.log(`🎉 SUCCESS: Views extracted! (${fullMetrics.views})`);
                        } else if (fullMetrics.likes > quickMetrics.likes) {
                            console.log(`📈 PARTIAL: Better likes count (${fullMetrics.likes} vs ${quickMetrics.likes})`);
                        } else {
                            console.log(`⚠️ WARNING: View extraction didn't improve results`);
                        }
                    } else {
                        console.log(`❌ Full validation failed (${viewTime}ms)`);
                    }
                } else {
                    console.log('⏭️ View extraction disabled for this test');
                }
                
            } catch (error) {
                console.log(`❌ Error testing ${url}: ${error.message}`);
                console.log(`   Stack: ${error.stack.split('\n')[1]}`);
            }
            
            console.log(''); // Add spacing
        }
        
        // Cleanup
        await validator.cleanup();
        console.log(`✅ Cleaned up ${configTest.name}`);
    }
}

async function testSpecificTwitterURL(url) {
    console.log('🎯 Testing Specific Twitter URL');
    console.log('='.repeat(50));
    console.log(`URL: ${url}`);
    
    const TwitterValidator = require('../src/validators/twitterValidator');
    const validator = new TwitterValidator({
        enablePageExtraction: true,
        timeout: 30000,
        quickTimeout: 5000
    });
    
    try {
        // Step 1: Extract tweet ID and validate URL
        console.log('\n🔍 Step 1: URL Validation');
        const tweetId = validator.extractTweetId(url);
        if (!tweetId) {
            console.log('❌ Invalid Twitter URL - could not extract tweet ID');
            return;
        }
        console.log(`✅ Tweet ID: ${tweetId}`);
        
        // Step 2: Test syndication API (quick likes)
        console.log('\n⚡ Step 2: Testing Syndication API');
        const syndicationUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=a`;
        console.log(`Testing: ${syndicationUrl}`);
        
        const axios = require('axios');
        try {
            const response = await axios.get(syndicationUrl, {
                timeout: 5000,
                headers: {
                    'Referer': 'https://platform.twitter.com/',
                    'Origin': 'https://platform.twitter.com',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            console.log(`✅ Syndication API response: ${response.status}`);
            console.log(`   Content-Type: ${response.headers['content-type']}`);
            
            if (response.data) {
                const likes = parseInt(response.data.favorite_count || response.data.favoriteCount || response.data.like_count) || 0;
                console.log(`   Likes found: ${likes}`);
                console.log(`   Created: ${response.data.created_at || 'N/A'}`);
                console.log(`   Author: ${response.data.user?.screen_name || 'N/A'}`);
            }
        } catch (apiError) {
            console.log(`❌ Syndication API failed: ${apiError.message}`);
        }
        
        // Step 3: Test quick likes method
        console.log('\n⚡ Step 3: Testing Quick Likes Method');
        const quickStart = Date.now();
        const quickMetrics = await validator.quickLikesCheck(url);
        const quickTime = Date.now() - quickStart;
        
        if (quickMetrics) {
            console.log(`✅ Quick likes (${quickTime}ms):`);
            console.log(`   Likes: ${quickMetrics.likes}`);
            console.log(`   Link: ${quickMetrics.link}`);
            console.log(`   Published: ${quickMetrics.publishedAt || 'N/A'}`);
        } else {
            console.log(`❌ Quick likes failed (${quickTime}ms)`);
        }
        
        // Step 4: Test puppeteer view extraction (using EXACT code from your working twitterValidator)
        console.log('\n👀 Step 4: Testing Puppeteer View Extraction (Your Exact Code)');
        const puppeteer = require('puppeteer-extra');
        const StealthPlugin = require('puppeteer-extra-plugin-stealth');
        puppeteer.use(StealthPlugin());
        
        let browser = null;
        try {
            console.log('🚀 Launching browser...');
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            
            const page = await browser.newPage();
            console.log('✅ Browser launched');
            
            // Use the EXACT URL format from your working code
            const twitterUrl = `https://twitter.com/i/status/${tweetId}`;
            console.log(`🔍 Navigating to: ${twitterUrl}`);
            
            await page.goto(twitterUrl, { 
                waitUntil: 'domcontentloaded', 
                timeout: 30000 
            });
            console.log('✅ Page loaded');
            
            // Use setTimeout instead of page.waitForTimeout (newer puppeteer)
            console.log('⏳ Waiting 3 seconds for content...');
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Use the EXACT code from your twitterValidator.js
            console.log('🔍 Searching for metrics with your exact CSS selector...');
            const metrics = await page.evaluate(() => {
                const spans = document.querySelectorAll('span.css-1jxf684.r-bcqeeo.r-1ttztb7.r-qvutc0.r-poiln3');
                const numbers = [];
                
                spans.forEach(span => {
                    const text = span.textContent.trim();
                    if (/^\d+(\.\d+)?[KMB]?$/.test(text)) {
                        numbers.push(text);
                    }
                });
                
                return numbers;
            });
            
            console.log(`✅ Found ${metrics.length} metric numbers: [${metrics.join(', ')}]`);
            
            if (metrics.length > 0) {
                // Use your exact parseNumber logic
                const parsedNumbers = metrics.map(num => validator.parseNumber(num)).filter(n => n > 0);
                
                if (parsedNumbers.length > 0) {
                    // Views are typically the largest number
                    const views = Math.max(...parsedNumbers);
                    // Likes are typically smaller
                    const likes = parsedNumbers.find(n => n < views && n > 0) || 0;
                    
                    console.log(`🎯 Your exact logic result: Views=${views.toLocaleString()}, Likes=${likes.toLocaleString()}`);
                    
                    // Show the breakdown
                    console.log('📊 Parsed numbers breakdown:');
                    metrics.forEach((text, i) => {
                        const parsed = validator.parseNumber(text);
                        console.log(`   ${i + 1}. "${text}" → ${parsed.toLocaleString()}`);
                    });
                } else {
                    console.log('❌ No valid numbers after parsing');
                }
            } else {
                console.log('❌ No metrics found with your CSS selector');
                
                // Debug: try alternative selectors
                console.log('🔍 Trying alternative selectors...');
                const debugInfo = await page.evaluate(() => {
                    const results = {};
                    
                    // Try different selectors that might have metrics
                    const selectors = [
                        'span[data-testid]',
                        'span.css-1jxf684',
                        'span.r-bcqeeo',
                        'span[aria-label]',
                        'div[data-testid="like"] span',
                        'div[data-testid="retweet"] span',
                        'div[data-testid="reply"] span',
                        'span:contains("views")',
                        'span:contains("likes")'
                    ];
                    
                    selectors.forEach(selector => {
                        try {
                            const elements = document.querySelectorAll(selector);
                            results[selector] = elements.length;
                        } catch (e) {
                            results[selector] = `Error: ${e.message}`;
                        }
                    });
                    
                    // Get page title and check if it loaded properly
                    results.pageTitle = document.title;
                    results.bodyLength = document.body.innerText.length;
                    results.containsTwitter = document.body.innerText.includes('Twitter') || document.body.innerText.includes('X');
                    
                    return results;
                });
                
                console.log('🔍 Debug info:');
                Object.entries(debugInfo).forEach(([key, value]) => {
                    console.log(`   ${key}: ${value}`);
                });
            }
            
        } catch (puppeteerError) {
            console.log(`❌ Puppeteer error: ${puppeteerError.message}`);
            console.log(`   Stack: ${puppeteerError.stack.split('\n')[1]}`);
        } finally {
            if (browser) {
                await browser.close();
            }
        }
        
        // Step 5: Test full validation method
        console.log('\n🔄 Step 5: Testing Full Validation Method');
        const fullStart = Date.now();
        const fullMetrics = await validator.validateEngagement(url);
        const fullTime = Date.now() - fullStart;
        
        if (fullMetrics) {
            console.log(`✅ Full validation (${fullTime}ms):`);
            console.log(`   Views: ${fullMetrics.views || 0}`);
            console.log(`   Likes: ${fullMetrics.likes || 0}`);
            console.log(`   Retweets: ${fullMetrics.retweets || 0}`);
            console.log(`   Replies: ${fullMetrics.replies || 0}`);
            console.log(`   Published: ${fullMetrics.publishedAt || 'N/A'}`);
        } else {
            console.log(`❌ Full validation failed (${fullTime}ms)`);
        }
        
    } catch (error) {
        console.log(`❌ Test failed: ${error.message}`);
        console.log(error.stack);
    } finally {
        await validator.cleanup();
    }
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length > 0) {
        // Test specific URL
        const url = args[0];
        if (url.includes('twitter.com') || url.includes('x.com')) {
            await testSpecificTwitterURL(url);
        } else {
            console.log('❌ Please provide a valid Twitter/X URL');
            console.log('Usage: node scripts/testViewDetection.js [TWITTER_URL]');
            process.exit(1);
        }
    } else {
        // Run full test suite
        await testViewDetection();
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('Script failed:', error);
        process.exit(1);
    });
}

module.exports = { testViewDetection, testSpecificTwitterURL };