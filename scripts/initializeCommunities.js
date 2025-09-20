const mongoose = require('mongoose');
require('dotenv').config();

const Community = require('./models/Community');

async function initializeCommunities() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Check if communities already exist
    const existingCommunities = await Community.find();
    if (existingCommunities.length > 0) {
      console.log('Communities already exist:', existingCommunities.map(c => c.name));
      return;
    }

    // Create JEE and NEET communities
    const communities = [
      {
        name: 'JEE',
        description: 'Joint Entrance Examination community for engineering aspirants. Share notes, practice questions, and discuss strategies for JEE Main and Advanced.',
        category: 'academic',
        icon: '🔧',
        color: '#3B82F6',
        settings: {
          allowContentSharing: true,
          allowQuizCreation: true,
          requireModeration: false
        }
      },
      {
        name: 'NEET',
        description: 'National Eligibility Entrance Test community for medical aspirants. Collaborate on biology, chemistry, and physics preparation.',
        category: 'academic',
        icon: '🩺',
        color: '#10B981',
        settings: {
          allowContentSharing: true,
          allowQuizCreation: true,
          requireModeration: false
        }
      }
    ];

    // Insert communities
    const createdCommunities = await Community.insertMany(communities);
    console.log('Communities created successfully:');
    createdCommunities.forEach(community => {
      console.log(`- ${community.name}: ${community._id}`);
    });

  } catch (error) {
    console.error('Error initializing communities:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Run if this file is executed directly
if (require.main === module) {
  initializeCommunities();
}

module.exports = initializeCommunities;