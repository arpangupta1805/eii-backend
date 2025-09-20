const mongoose = require('mongoose');
const Community = require('./models/Community');

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/personalized-learning';

async function initializeCommunities() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Check if communities already exist
    const existingCommunities = await Community.find();
    if (existingCommunities.length > 0) {
      console.log('Communities already exist. Skipping initialization.');
      console.log('Existing communities:');
      existingCommunities.forEach(community => {
        console.log(`- ${community.name} (${community.category}) - Active: ${community.isActive}`);
      });
      return;
    }

    // Create default communities
    const defaultCommunities = [
      {
        name: 'JEE',
        description: 'A community for JEE (Joint Entrance Examination) aspirants to share resources, discuss concepts, and prepare together for engineering entrance exams.',
        category: 'academic',
        tags: ['physics', 'chemistry', 'mathematics', 'jee-main', 'jee-advanced'],
        isPublic: true,
        isActive: true,
        settings: {
          allowQuizCreation: true,
          allowContentSharing: true,
          moderationEnabled: true
        }
      },
      {
        name: 'NEET',
        description: 'A dedicated space for NEET (National Eligibility cum Entrance Test) aspirants to collaborate, share study materials, and excel in medical entrance examinations.',
        category: 'academic',
        tags: ['biology', 'chemistry', 'physics', 'neet', 'medical-entrance'],
        isPublic: true,
        isActive: true,
        settings: {
          allowQuizCreation: true,
          allowContentSharing: true,
          moderationEnabled: true
        }
      }
    ];

    // Insert communities
    const createdCommunities = await Community.insertMany(defaultCommunities);
    console.log(`Successfully created ${createdCommunities.length} communities:`);
    
    createdCommunities.forEach(community => {
      console.log(`- ${community.name} (${community.category}) - ID: ${community._id}`);
    });

    console.log('Community initialization completed successfully!');

  } catch (error) {
    console.error('Error initializing communities:', error);
  } finally {
    // Close the connection
    await mongoose.connection.close();
    console.log('Database connection closed');
    process.exit(0);
  }
}

// Run the initialization
initializeCommunities();
