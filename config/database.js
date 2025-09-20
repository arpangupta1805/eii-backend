const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Connection options for better stability in production
    const options = {
      serverSelectionTimeoutMS: 30000, // 30 seconds
      socketTimeoutMS: 45000, // 45 seconds
      maxPoolSize: 10, // Maintain up to 10 socket connections only to prevent the overload 
      minPoolSize: 5, // Maintain a minimum of 5 socket connections
      maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
      bufferCommands: false, // Disable mongoose buffering for commands
    };

    console.log('Attempting to connect to MongoDB...');
    console.log('Connection URI format: mongodb+srv://username:***@cluster...');
    
    const conn = await mongoose.connect(process.env.MONGODB_URI, options);
    
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    console.log(`Database Name: ${conn.connection.db.databaseName}`);
    
    // Set up connection event listeners
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected');
    });
    
    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected');
    });
    
    mongoose.connection.on('connecting', () => {
      console.log('Connecting to MongoDB...');
    });
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      try {
        await mongoose.connection.close();
        console.log('MongoDB connection closed through app termination');
        process.exit(0);
      } catch (error) {
        console.error('Error during MongoDB disconnection:', error);
        process.exit(1);
      }
    });
    
  } catch (error) {
    console.error('MongoDB connection failed:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.code
    });
    
    // In production, you might want to retry connection instead of exiting
    if (process.env.NODE_ENV === 'production') {
      console.error('Retrying connection in 5 seconds...');
      setTimeout(() => {
        connectDB();
      }, 5000);
    } else {
      process.exit(1);
    }
  }
};

module.exports = connectDB;
