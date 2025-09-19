const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class DataService {
  constructor() {
    this.dataDir = path.join(__dirname, '../data');
    this.initializeDataDir();
  }
  async initializeDataDir() {
    try {
      await fs.access(this.dataDir);
    } catch {
      await fs.mkdir(this.dataDir, { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'users'), { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'content'), { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'quizzes'), { recursive: true });
    }
  }

  // User operations
  async createUser(userData) {
    const userId = uuidv4();
    const user = {
      id: userId,
      ...userData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.writeJSON(`users/${userId}.json`, user);
    return user;
  }

  async getUser(userId) {
    try {
      return await this.readJSON(`users/${userId}.json`);
    } catch {
      return null;
    }
  }

  async getUserByEmail(email) {
    try {
      const usersDir = path.join(this.dataDir, 'users');
      const files = await fs.readdir(usersDir);
      
      for (const file of files) {
        const user = await this.readJSON(`users/${file}`);
        if (user.email === email) {
          return user;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async updateUser(userId, updates) {
    const user = await this.getUser(userId);
    if (!user) throw new Error('User not found');

    const updatedUser = {
      ...user,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    await this.writeJSON(`users/${userId}.json`, updatedUser);
    return updatedUser;
  }

  // Content operations
  async createContent(userId, contentData) {
    const contentId = uuidv4();
    const content = {
      id: contentId,
      userId,
      ...contentData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.writeJSON(`content/${contentId}.json`, content);
    return content;
  }

  async getContent(contentId) {
    try {
      return await this.readJSON(`content/${contentId}.json`);
    } catch {
      return null;
    }
  }

  async getUserContent(userId) {
    try {
      const contentDir = path.join(this.dataDir, 'content');
      const files = await fs.readdir(contentDir);
      const userContent = [];

      for (const file of files) {
        const content = await this.readJSON(`content/${file}`);
        if (content.userId === userId) {
          userContent.push(content);
        }
      }

      return userContent.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch {
      return [];
    }
  }

  async updateContent(contentId, updates) {
    const content = await this.getContent(contentId);
    if (!content) throw new Error('Content not found');

    const updatedContent = {
      ...content,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    await this.writeJSON(`content/${contentId}.json`, updatedContent);
    return updatedContent;
  }

  async deleteContent(contentId) {
    const filePath = path.join(this.dataDir, `content/${contentId}.json`);
    await fs.unlink(filePath);
  }

  // Quiz operations
  async createQuiz(userId, quizData) {
    const quizId = uuidv4();
    const quiz = {
      id: quizId,
      userId,
      ...quizData,
      createdAt: new Date().toISOString()
    };

    await this.writeJSON(`quizzes/${quizId}.json`, quiz);
    return quiz;
  }

  async getQuiz(quizId) {
    try {
      return await this.readJSON(`quizzes/${quizId}.json`);
    } catch {
      return null;
    }
  }

  async getUserQuizzes(userId) {
    try {
      const quizzesDir = path.join(this.dataDir, 'quizzes');
      const files = await fs.readdir(quizzesDir);
      const userQuizzes = [];

      for (const file of files) {
        const quiz = await this.readJSON(`quizzes/${file}`);
        if (quiz.userId === userId) {
          userQuizzes.push(quiz);
        }
      }

      return userQuizzes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch {
      return [];
    }
  }

  async updateQuiz(quizId, updates) {
    const quiz = await this.getQuiz(quizId);
    if (!quiz) throw new Error('Quiz not found');

    const updatedQuiz = {
      ...quiz,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    await this.writeJSON(`quizzes/${quizId}.json`, updatedQuiz);
    return updatedQuiz;
  }

  // Helper methods
  async readJSON(filePath) {
    const fullPath = path.join(this.dataDir, filePath);
    const data = await fs.readFile(fullPath, 'utf8');
    return JSON.parse(data);
  }

  async writeJSON(filePath, data) {
    const fullPath = path.join(this.dataDir, filePath);
    await fs.writeFile(fullPath, JSON.stringify(data, null, 2), 'utf8');
  }

  // Analytics helper
  async getUserAnalytics(userId) {
    const [user, content, quizzes] = await Promise.all([
      this.getUser(userId),
      this.getUserContent(userId),
      this.getUserQuizzes(userId)
    ]);

    const completedQuizzes = quizzes.filter(q => q.completed);
    const totalQuizzes = quizzes.length;
    const averageScore = completedQuizzes.length > 0 
      ? completedQuizzes.reduce((sum, q) => sum + (q.score || 0), 0) / completedQuizzes.length 
      : 0;

    return {
      user,
      stats: {
        totalContent: content.length,
        totalQuizzes,
        completedQuizzes: completedQuizzes.length,
        averageScore: Math.round(averageScore),
        joinDate: user?.createdAt,
        lastActivity: Math.max(
          new Date(user?.updatedAt || 0),
          ...(content.map(c => new Date(c.createdAt))),
          ...(quizzes.map(q => new Date(q.createdAt)))
        )
      },
      recentContent: content.slice(0, 5),
      recentQuizzes: quizzes.slice(0, 5)
    };
  }
}

module.exports = new DataService();
