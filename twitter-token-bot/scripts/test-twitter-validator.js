// test-cleaned-validator.js - Test the cleaned TwitterValidator
require('dotenv').config();

async function testCleanedValidator() {
    console.log('🧪 Testing Cleaned Twitter Validator');
    console.log('===================================');
    
    // Test the cleaned version
    const TwitterValidator = require('../src/validators/twitterValidator');
    
    const validator = new TwitterValidator({
        enablePageExtraction: true // Enable the working method
    });
    
    const testUrl = 'https://twitter.com/NoesisTracker/status/1925890127764549705';
    
    console.log(`Testing URL: ${testUrl}\n`);
    
    try {
        console.log('🚀 Running cleaned validation...');
        const startTime = Date.now();
        
        const result = await validator.validateEngagement(testUrl);
        
        const duration = Date.now() - startTime;
        
        console.log('\n📊 Results:');
        console.log(`   Views: ${result?.views || 0}`);
        console.log(`   Likes: ${result?.likes || 0}`);
        console.log(`   Retweets: ${result?.retweets || 0}`);
        console.log(`   Replies: ${result?.replies || 0}`);
        console.log(`   Published: ${result?.publishedAt || 'N/A'}`);
        console.log(`   Duration: ${duration}ms`);
        
        if (result?.views > 0) {
            console.log('\n✅ SUCCESS: View count found with cleaned validator!');
        } else {
            console.log('\n⚠️ No view count found');
        }
        
        // Test with page extraction disabled
        console.log('\n🔄 Testing with page extraction DISABLED...');
        const validatorNoPageExtraction = new TwitterValidator({
            enablePageExtraction: false // Only use syndication API
        });
        
        const resultNoPageExtraction = await validatorNoPageExtraction.validateEngagement(testUrl);
        
        console.log('\n📊 Results (No Page Extraction):');
        console.log(`   Views: ${resultNoPageExtraction?.views || 0}`);
        console.log(`   Likes: ${resultNoPageExtraction?.likes || 0}`);
        console.log(`   Retweets: ${resultNoPageExtraction?.retweets || 0}`);
        console.log(`   Replies: ${resultNoPageExtraction?.replies || 0}`);
        
        // Comparison
        console.log('\n🔍 COMPARISON:');
        console.log('==============');
        console.log(`With Page Extraction:    Views=${result?.views || 0}, Duration=${duration}ms`);
        console.log(`Without Page Extraction: Views=${resultNoPageExtraction?.views || 0}, Duration=<100ms`);
        
        if ((result?.views || 0) > (resultNoPageExtraction?.views || 0)) {
            console.log('\n✨ Page extraction successfully enhanced the results!');
        } else {
            console.log('\n📝 Page extraction didn\'t improve results for this tweet');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testCleanedValidator();