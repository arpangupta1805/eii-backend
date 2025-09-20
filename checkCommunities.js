const mongoose = require('mongoose');
const Community = require('./models/Community');

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/eii';

async function checkCommunities() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Check existing communities
    const communities = await Community.find();
    console.log('\n=== COMMUNITY DATABASE STATUS ===');
    console.log(`Total communities found: ${communities.length}`);
    
    if (communities.length === 0) {
      console.log('❌ No communities found in database!');
      console.log('👉 Run: node initializeCommunities.js');
    } else {
      console.log('✅ Communities found:');
      communities.forEach((community, index) => {
        console.log(`${index + 1}. ${community.name}`);
        console.log(`   - ID: ${community._id}`);
        console.log(`   - Category: ${community.category}`);
        console.log(`   - Active: ${community.isActive}`);
        console.log(`   - Description: ${community.description.substring(0, 100)}...`);
        console.log('');
      });
    }

  } catch (error) {
    console.error('❌ Error checking communities:', error);
  } finally {
    // Close the connection
    await mongoose.connection.close();
    console.log('Database connection closed');
    process.exit(0);
  }
}

// Run the check
checkCommunities();