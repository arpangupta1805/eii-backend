const { Translate } = require('@google-cloud/translate').v2;

class TranslationService {
  constructor() {
    if (!process.env.GOOGLE_TRANSLATE_API_KEY) {
      throw new Error('GOOGLE_TRANSLATE_API_KEY environment variable is required');
    }
    
    this.translate = new Translate({
      key: process.env.GOOGLE_TRANSLATE_API_KEY,
      projectId: process.env.GOOGLE_TRANSLATE_PROJECT_ID || 'eii-learning-platform'
    });
  }

  /**
   * Translates text to the specified target language
   * @param {string} text - Text to translate
   * @param {string} targetLanguage - Target language code (e.g., 'hi', 'gu', 'mr', 'bn', 'ru', 'zh')
   * @param {string} sourceLanguage - Source language code (default: 'en')
   * @returns {Promise<string>} - Translated text
   */
  async translateText(text, targetLanguage, sourceLanguage = 'en') {
    try {
      // Skip translation if target language is the same as source
      if (targetLanguage === sourceLanguage) {
        return text;
      }

      const [translation] = await this.translate.translate(text, {
        from: sourceLanguage,
        to: targetLanguage
      });

      return translation;
    } catch (error) {
      console.error('Translation error:', error);
      throw new Error(`Failed to translate text: ${error.message}`);
    }
  }

  /**
   * Translates content object with multiple fields
   * @param {Object} content - Content object to translate
   * @param {string} targetLanguage - Target language code
   * @param {Array} fieldsToTranslate - Array of field paths to translate
   * @returns {Promise<Object>} - Translated content object
   */
  async translateContent(content, targetLanguage, fieldsToTranslate = []) {
    try {
      if (targetLanguage === 'en') {
        return content;
      }

      const translatedContent = { ...content };

      // Default fields to translate if not specified
      const defaultFields = [
        'title',
        'aiSummary.summary',
        'aiSummary.sections[].title',
        'aiSummary.sections[].summary',
        'aiSummary.sections[].keyPoints[]'
      ];

      const fields = fieldsToTranslate.length > 0 ? fieldsToTranslate : defaultFields;

      for (const fieldPath of fields) {
        await this.translateFieldPath(translatedContent, fieldPath, targetLanguage);
      }

      return translatedContent;
    } catch (error) {
      console.error('Content translation error:', error);
      throw new Error(`Failed to translate content: ${error.message}`);
    }
  }

  /**
   * Translates a specific field path in an object
   * @param {Object} obj - Object containing the field
   * @param {string} fieldPath - Dot notation path to field (e.g., 'aiSummary.summary')
   * @param {string} targetLanguage - Target language code
   */
  async translateFieldPath(obj, fieldPath, targetLanguage) {
    try {
      const parts = fieldPath.split('.');
      let current = obj;
      const path = [];

      // Navigate to the field
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        
        if (part.includes('[]')) {
          // Handle array notation
          const arrayField = part.replace('[]', '');
          path.push(arrayField);
          current = current[arrayField];
          
          if (Array.isArray(current)) {
            // Translate each item in array
            for (let j = 0; j < current.length; j++) {
              await this.translateFieldPath(current[j], parts.slice(i + 1).join('.'), targetLanguage);
            }
            return;
          }
        } else {
          path.push(part);
          current = current[part];
        }

        if (!current) return; // Field doesn't exist
      }

      // Translate the final field
      const finalField = parts[parts.length - 1];
      
      if (finalField.includes('[]')) {
        const arrayField = finalField.replace('[]', '');
        if (Array.isArray(current[arrayField])) {
          for (let i = 0; i < current[arrayField].length; i++) {
            if (typeof current[arrayField][i] === 'string') {
              current[arrayField][i] = await this.translateText(current[arrayField][i], targetLanguage);
            }
          }
        }
      } else if (typeof current[finalField] === 'string') {
        current[finalField] = await this.translateText(current[finalField], targetLanguage);
      }
    } catch (error) {
      console.error(`Error translating field path ${fieldPath}:`, error);
    }
  }

  /**
   * Translates quiz questions and options
   * @param {Object} quiz - Quiz object to translate
   * @param {string} targetLanguage - Target language code
   * @returns {Promise<Object>} - Translated quiz object
   */
  async translateQuiz(quiz, targetLanguage) {
    try {
      if (targetLanguage === 'en') {
        return quiz;
      }

      const translatedQuiz = { ...quiz };

      if (translatedQuiz.questions && Array.isArray(translatedQuiz.questions)) {
        for (const question of translatedQuiz.questions) {
          // Translate question text
          if (question.question) {
            question.question = await this.translateText(question.question, targetLanguage);
          }

          // Translate options
          if (question.options && Array.isArray(question.options)) {
            for (let i = 0; i < question.options.length; i++) {
              question.options[i] = await this.translateText(question.options[i], targetLanguage);
            }
          }

          // Translate explanation if exists
          if (question.explanation) {
            question.explanation = await this.translateText(question.explanation, targetLanguage);
          }
        }
      }

      return translatedQuiz;
    } catch (error) {
      console.error('Quiz translation error:', error);
      throw new Error(`Failed to translate quiz: ${error.message}`);
    }
  }

  /**
   * Get supported languages
   * @returns {Array} - Array of supported language objects
   */
  getSupportedLanguages() {
    return [
      { code: 'en', name: 'English', nativeName: 'English' },
      { code: 'hi', name: 'Hindi', nativeName: 'हिंदी' },
      { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી' },
      { code: 'mr', name: 'Marathi', nativeName: 'मराठी' },
      { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
      { code: 'ru', name: 'Russian', nativeName: 'Русский' },
      { code: 'zh', name: 'Chinese', nativeName: '中文' }
    ];
  }

  /**
   * Check if language is supported
   * @param {string} langCode - Language code to check
   * @returns {boolean} - Whether language is supported
   */
  isLanguageSupported(langCode) {
    const supportedLanguages = this.getSupportedLanguages();
    return supportedLanguages.some(lang => lang.code === langCode);
  }
}

module.exports = new TranslationService();
