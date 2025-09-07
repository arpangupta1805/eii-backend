const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiService {
  constructor() {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is required');
    }
    
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  async generateContentSummary(text, title = '') {
    try {
      const prompt = `
        Analyze the following content and provide a comprehensive summary:
        
        Title: ${title}
        Content: ${text}
        
        Please provide a JSON response with the following structure:
        {
          "summary": "A thorough summary of the content in 4–6 detailed paragraphs, covering all major arguments, examples, and explanations. Highlight not just the surface points, but also context, implications, and deeper insights from the text.",
          "keyTopics": ["topic1", "topic2", "topic3", "…"],
          "difficulty": "beginner|intermediate|advanced",
          "estimatedReadTime": "X minutes",
          "sections": [
            {
              "title": "Section Title",
              "summary": "A multi-sentence, detailed summary of this section capturing the main ideas, supporting details, and examples.",
              "keyPoints": [
                "Clear, detailed point 1",
                "Clear, detailed point 2",
                "Additional nuance if present"
              ]
            }
          ]
        }
        
        Respond with only the JSON object.
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text_response = response.text();
      
      // Clean up response and parse JSON
      const cleanResponse = text_response.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(cleanResponse);
    } catch (error) {
      console.error('Error generating content summary:', error);
      throw new Error('Failed to generate content summary');
    }
  }

  async generateQuiz(content, options = {}) {
    const {
      difficulty = 'medium',
      questionsCount = 5,
      questionTypes = ['multiple-choice', 'true-false']
    } = options;

    try {
      const prompt = `
        Based on the following content, generate a quiz:
        
        Content: ${content}
        
        Requirements:
        - Difficulty: ${difficulty}
        - Number of questions: ${questionsCount}
        - Question types: ${questionTypes.join(', ')}
        
        Please provide a JSON response with the following structure:
        {
          "questions": [
            {
              "id": "q1",
              "type": "multiple-choice",
              "question": "Question text",
              "options": ["option1", "option2", "option3", "option4"],
              "correctAnswer": "option1",
              "explanation": "Why this answer is correct",
              "difficulty": "medium",
              "topic": "main topic this question covers"
            }
          ],
          "metadata": {
            "totalQuestions": ${questionsCount},
            "difficulty": "${difficulty}",
            "estimatedTime": "X minutes",
            "topics": ["topic1", "topic2"]
          }
        }
        
        Respond with only the JSON object.
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text_response = response.text();
      
      // Clean up response and parse JSON
      const cleanResponse = text_response.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(cleanResponse);
    } catch (error) {
      console.error('Error generating quiz:', error);
      throw new Error('Failed to generate quiz');
    }
  }

  async analyzeQuizResults(questions, userAnswers) {
    try {
      const prompt = `
        Analyze the quiz results and provide feedback:
        
        Questions: ${JSON.stringify(questions)}
        User Answers: ${JSON.stringify(userAnswers)}
        
        Please provide a JSON response with:
        {
          "score": 85,
          "totalQuestions": 10,
          "correctAnswers": 8,
          "performance": "good|excellent|needs_improvement",
          "feedback": "Overall feedback message",
          "weakAreas": ["topic1", "topic2"],
          "strongAreas": ["topic3", "topic4"],
          "recommendations": ["suggestion1", "suggestion2"]
        }
        
        Respond with only the JSON object.
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text_response = response.text();
      
      const cleanResponse = text_response.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(cleanResponse);
    } catch (error) {
      console.error('Error analyzing quiz results:', error);
      throw new Error('Failed to analyze quiz results');
    }
  }

  async generateQuiz(content, sections, options = {}) {
    try {
      const {
        questionsPerSection = 3,
        questionTypes = ['multiple-choice', 'true-false'],
        difficulty = 'mixed'
      } = options;

      const sectionsText = sections.map(section => 
        `Section: ${section.title}\nContent: ${section.summary}\nKey Points: ${section.keyPoints?.join(', ') || 'N/A'}`
      ).join('\n\n');

      const prompt = `
        Based on the following content, generate a comprehensive quiz with ${questionsPerSection} questions per section:
        
        Content Title: ${content.title}
        Overall Summary: ${content.aiSummary?.summary || 'N/A'}
        
        Sections:
        ${sectionsText}
        
        Generate questions that test understanding, application, and critical thinking. 
        
        Requirements:
        - ${questionsPerSection} questions per section
        - Mix of multiple-choice and true/false questions
        - Questions should cover key concepts from each section
        - Include clear explanations for correct answers
        - Difficulty: ${difficulty}
        
        Please provide a JSON response with the following structure:
        {
          "title": "${content.title} - Quiz",
          "description": "Quiz generated from content analysis",
          "totalQuestions": number,
          "estimatedTime": "X minutes",
          "questions": [
            {
              "sectionTitle": "Section name",
              "question": "Question text",
              "type": "multiple-choice|true-false",
              "options": ["option1", "option2", "option3", "option4"], // for multiple-choice only
              "correctAnswer": "correct option or true/false",
              "explanation": "Why this is the correct answer",
              "difficulty": "easy|medium|hard",
              "points": number
            }
          ]
        }
        
        Respond with only the JSON object.
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text_response = response.text();
      
      // Clean up response and parse JSON
      const cleanResponse = text_response.replace(/```json\n?|\n?```/g, '').trim();
      const quizData = JSON.parse(cleanResponse);
      
      // Add metadata
      quizData.generatedAt = new Date();
      quizData.contentId = content._id;
      
      return quizData;
    } catch (error) {
      console.error('Error generating quiz:', error);
      throw new Error('Failed to generate quiz from content');
    }
  }

  async generateQuizFromTopic({ topic, description = '', difficulty = 'medium', numQuestions = 5 }) {
    try {
      const difficultyMap = {
        'easy': 'beginner level with basic concepts',
        'medium': 'intermediate level with moderate complexity',
        'hard': 'advanced level with complex concepts'
      };

      const prompt = `
        Generate a comprehensive quiz on the topic: "${topic}"
        ${description ? `Additional context: ${description}` : ''}
        
        Requirements:
        - Generate exactly ${numQuestions} questions
        - Difficulty level: ${difficultyMap[difficulty] || 'intermediate level'}
        - Mix of multiple-choice (70%) and true/false (30%) questions
        - Questions should test understanding, application, and knowledge
        - Include clear explanations for correct answers
        - Cover different aspects of the topic
        
        Please provide a JSON response with the following structure:
        {
          "title": "${topic} - Custom Quiz",
          "description": "A personalized quiz on ${topic}",
          "totalQuestions": ${numQuestions},
          "estimatedTime": "${Math.ceil(numQuestions * 1.5)} minutes",
          "questions": [
            {
              "sectionTitle": "${topic}",
              "question": "Question text",
              "type": "multiple-choice|true-false",
              "options": ["option1", "option2", "option3", "option4"], // for multiple-choice only
              "correctAnswer": "correct option or true/false",
              "explanation": "Why this is the correct answer",
              "difficulty": "${difficulty}",
              "points": 1
            }
          ]
        }
        
        Make sure all questions are relevant to "${topic}" and appropriate for ${difficulty} difficulty level.
        Respond with only the JSON object.
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text_response = response.text();
      
      // Clean up response and parse JSON
      const cleanResponse = text_response.replace(/```json\n?|\n?```/g, '').trim();
      const quizData = JSON.parse(cleanResponse);
      
      // Add metadata
      quizData.generatedAt = new Date();
      quizData.topic = topic;
      quizData.customDescription = description;
      
      return quizData;
    } catch (error) {
      console.error('Error generating quiz from topic:', error);
      throw new Error('Failed to generate quiz from topic');
    }
  }

  async generateQuizSummary(quiz, attempt) {
    try {
      const correctAnswers = attempt.answers.filter(answer => answer.isCorrect).length;
      const totalQuestions = attempt.answers.length;
      const score = attempt.score;

      console.log('=== AI SUMMARY DEBUG ===');
      console.log('Total answers in attempt:', attempt.answers.length);
      console.log('Answers marked as correct:', correctAnswers);
      console.log('Score:', score);
      console.log('Individual answers:', attempt.answers.map(a => ({
        questionId: a.questionId,
        userAnswer: a.userAnswer,
        isCorrect: a.isCorrect
      })));
      console.log('========================');

      // Prepare data for AI analysis
      const quizData = {
        title: quiz.title,
        totalQuestions,
        correctAnswers,
        score,
        timeSpent: attempt.timeSpent,
        questions: quiz.questions.map(q => ({
          question: q.question,
          type: q.type,
          sectionTitle: q.sectionTitle,
          difficulty: q.difficulty
        })),
        userAnswers: attempt.answers.map(a => ({
          question: quiz.questions.id(a.questionId)?.question,
          userAnswer: a.userAnswer,
          isCorrect: a.isCorrect,
          sectionTitle: a.sectionTitle
        })),
        sectionScores: attempt.sectionScores
      };

      const prompt = `
        Analyze the following quiz performance and generate a comprehensive summary:
        
        Quiz Title: ${quiz.title}
        Score: ${score}%
        Questions Answered: ${correctAnswers}/${totalQuestions}
        Time Spent: ${attempt.timeSpent} minutes
        
        Section Performance:
        ${attempt.sectionScores.map(section => 
          `- ${section.sectionTitle}: ${section.score}% (${section.correctAnswers}/${section.totalQuestions})`
        ).join('\n')}
        
        Areas where user struggled:
        ${attempt.answers.filter(a => !a.isCorrect).map(a => 
          `- ${a.sectionTitle}: ${quiz.questions.id(a.questionId)?.question}`
        ).join('\n')}
        
        Please provide a JSON response with the following structure:
        {
          "overallPerformance": "excellent|good|average|needs-improvement",
          "summary": "Brief overall performance summary (2-3 sentences)",
          "strengths": ["strength1", "strength2", "strength3"],
          "weaknesses": ["weakness1", "weakness2"],
          "recommendations": ["recommendation1", "recommendation2", "recommendation3"],
          "topicsMastered": ["topic1", "topic2"],
          "topicsToReview": ["topic1", "topic2"],
          "nextSteps": "Personalized advice for next learning steps",
          "motivationalMessage": "Encouraging message based on performance"
        }
        
        Base the analysis on the actual performance data and provide constructive feedback.
        Respond with only the JSON object.
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text_response = response.text();
      
      // Clean up response and parse JSON
      const cleanResponse = text_response.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(cleanResponse);
    } catch (error) {
      console.error('Error generating quiz summary:', error);
      throw new Error('Failed to generate quiz summary');
    }
  }

  // Chatbot methods
  async generateContextualResponse(userMessage, contentText, contentTitle, aiSummary) {
    try {
      const prompt = `
        You are an AI learning assistant helping a student understand educational content. 
        
        Context Information:
        - Content Title: ${contentTitle}
        - Content Summary: ${aiSummary?.summary || 'No summary available'}
        - Key Topics: ${aiSummary?.keyTopics ? aiSummary.keyTopics.join(', ') : 'No key topics available'}
        
        Full Content Text (for reference):
        ${contentText.substring(0, 3000)}...
        
        Student's Question: ${userMessage}
        
        Instructions:
        1. Answer the student's question based ONLY on the provided content
        2. Be helpful, educational, and encouraging
        3. If the question is not related to the content, politely redirect them to content-related topics
        4. Use examples from the content when possible
        5. Keep responses concise but informative (2-4 paragraphs)
        6. If you don't know something based on the content, say so honestly
        
        Provide a helpful response:
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
    } catch (error) {
      console.error('Error generating contextual response:', error);
      throw new Error('Failed to generate contextual response');
    }
  }

  async generateQuizContextualResponse(userMessage, contextData) {
    try {
      const { quizTitle, questions, userAnswers, score, totalQuestions, contentTitle, contentText, contentSummary } = contextData;
      
      const prompt = `
        You are an AI learning assistant helping a student with their quiz performance and understanding.
        
        Context Information:
        - Quiz Title: ${quizTitle}
        - Content Title: ${contentTitle}
        - Content Summary: ${contentSummary?.summary || 'No summary available'}
        ${score !== undefined ? `- Quiz Score: ${score}/${totalQuestions}` : '- Quiz not yet attempted'}
        
        Quiz Questions and User's Performance:
        ${questions.map((q, index) => {
          const userAnswer = userAnswers ? userAnswers[index] : null;
          return `
          Question ${index + 1}: ${q.question}
          Correct Answer: ${q.options[q.correctAnswer]}
          User's Answer: ${userAnswer !== null ? q.options[userAnswer] || 'Not answered' : 'Not answered'}
          `;
        }).join('\n')}
        
        Student's Question: ${userMessage}
        
        Instructions:
        1. Help the student understand the quiz content and their performance
        2. Explain concepts related to questions they got wrong
        3. Provide encouragement and learning tips
        4. Reference specific questions when relevant
        5. If they ask about content not in the quiz, relate it back to the quiz topics
        6. Keep responses educational and supportive
        
        Provide a helpful response:
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
    } catch (error) {
      console.error('Error generating quiz contextual response:', error);
      throw new Error('Failed to generate quiz contextual response');
    }
  }

  async generateGeneralResponse(userMessage) {
    try {
      const prompt = `
        You are an AI learning assistant for an educational platform called YATI-Discipline. 
        
        Student's Question: ${userMessage}
        
        Instructions:
        1. Provide helpful, educational responses
        2. Encourage learning and academic growth
        3. If asked about platform features, explain that you help with content understanding and quiz performance
        4. Keep responses encouraging and supportive
        5. If the question is too general, suggest they visit specific content or quiz sections for more targeted help
        
        Provide a helpful response:
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
    } catch (error) {
      console.error('Error generating general response:', error);
      throw new Error('Failed to generate general response');
    }
  }
}

module.exports = new GeminiService();
