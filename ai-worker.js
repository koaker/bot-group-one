// AI 计算 Worker
// 专门负责接收来自主机器人的异步请求，调用AI，并处理结果

// 全局配置
let CONFIG = {
  BOT_TOKEN: '',
  KV_NAMESPACE: 'TG_AUTOCCB_BOT',
  AI_SCAN_AUTO_DELETE: false,
};

// 初始化配置
function initConfig(env) {
  CONFIG.BOT_TOKEN = env.BOT_TOKEN || '';
  CONFIG.KV_NAMESPACE = env.KV_NAMESPACE || 'TG_AUTOCCB_BOT';
  CONFIG.AI_SCAN_AUTO_DELETE = env.AI_SCAN_AUTO_DELETE === 'true';
}

// Telegram API (与主Worker相同)
class TelegramAPI {
  static async request(method, params = {}) {
    const url = `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/${method}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await response.json();
  }

  static async sendMessage(chatId, text, options = {}) {
    return this.request('sendMessage', { chat_id: chatId, text, ...options });
  }

  static async editMessageText(chatId, messageId, text, options = {}) {
    return this.request('editMessageText', { chat_id: chatId, message_id: messageId, text, ...options });
  }

  static async deleteMessage(chatId, messageId) {
    return this.request('deleteMessage', { chat_id: chatId, message_id: messageId });
  }
}

// AI服务类 (与主Worker相同)
class AIService {
  static async getAIConfig(kv) {
    try {
      const config = await kv.get('ai:config');
      return config ? JSON.parse(config) : {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: '',
        enabled: false,
        customReply: true
      };
    } catch (error) {
      console.error('获取AI配置失败:', error);
      return null;
    }
  }

  static getNestedValue(obj, path) {
    if (!path) return obj;
    const keys = path.split('.');
    return keys.reduce((o, key) => (o && o[key] !== undefined) ? o[key] : undefined, obj);
  }

  static async callAI(prompt, content, kv) {
    const config = await this.getAIConfig(kv);
    if (!config || !config.enabled || !config.apiKey) {
      throw new Error('AI服务未启用或未配置API密钥');
    }

    let messages;
    let endpoint = config.endpoint;
    let requestBody;
    let headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    };

    if (config.provider === 'claude') {
      messages = [{ role: 'user', content: `${prompt}\n\n---\n\n${content}` }];
      headers['anthropic-version'] = '2023-06-01';
      requestBody = { model: config.model, messages, max_tokens: 200 };
    } else if (config.provider === 'gemini') {
      messages = [{ role: 'user', parts: [{ text: `${prompt}\n\n---\n\n${content}` }] }];
      endpoint = `${config.endpoint}?key=${config.apiKey}`;
      requestBody = { contents: messages };
      delete headers['Authorization'];
    } else { // OpenAI and compatible
      messages = [
        { role: 'system', content: prompt },
        { role: 'user', content: content }
      ];
      requestBody = { model: config.model, messages, max_tokens: 200 };
    }
    
    if (config.provider === 'custom' && config.customParams) {
        requestBody = { ...requestBody, ...config.customParams };
    }
    if (config.provider === 'custom' && config.customHeaders) {
        headers = { ...headers, ...config.customHeaders };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI API请求失败: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    let result;
    if (config.provider === 'claude') {
      result = data.content?.[0]?.text;
    } else if (config.provider === 'gemini') {
      result = data.candidates?.[0]?.content?.parts?.[0]?.text;
    } else if (config.provider === 'custom' && config.responsePath) {
      result = this.getNestedValue(data, config.responsePath);
    } else { // Default OpenAI
      result = data.choices?.[0]?.message?.content;
    }

    if (!result) {
      throw new Error('未能从AI响应中提取内容');
    }
    return result.trim();
  }
}


// 处理AI扫描任务
async function handleAIScan(data, kv) {
  const { text, msg, chatId, aiCustomPrompt } = data;
  try {
    const aiResult = await AIService.callAI(aiCustomPrompt, text, kv);
    console.log(`AI扫描结果 for msg ${msg.message_id}: ${aiResult}`);

    if (aiResult.startsWith('【违规】')) {
      const replyText = aiResult.replace('【违规】', '').trim();
      
      // 发送违规提示
      await TelegramAPI.sendMessage(chatId, `Hey @${msg.from.username || msg.from.first_name},\n\n${replyText}`, {
        reply_to_message_id: msg.message_id
      });

      // 如果配置了自动删除，则删除原消息
      if (CONFIG.AI_SCAN_AUTO_DELETE) {
        await TelegramAPI.deleteMessage(chatId, msg.message_id);
      }
    }
    // 如果是"正常"，则不进行任何操作
  } catch (error) {
    console.error(`处理AI扫描任务失败 for msg ${msg.message_id}:`, error);
    // 在这种情况下，我们选择静默失败，不打扰用户
  }
}

// 处理AI测试任务
async function handleAITest(data, kv) {
  const { testContent, msg, chatId, notificationMsgId } = data;
  try {
    // 对于测试，我们不需要系统提示词，直接发送内容
    const aiResult = await AIService.callAI("You are a helpful assistant.", testContent, kv);
    const replyText = `✅ AI测试成功\n\n📝 输入:\n${testContent}\n\n🤖 AI回复:\n${aiResult}`;
    
    if (notificationMsgId) {
      await TelegramAPI.editMessageText(chatId, notificationMsgId, replyText);
    } else {
      await TelegramAPI.sendMessage(chatId, replyText, { reply_to_message_id: msg.message_id });
    }
  } catch (error) {
    console.error(`处理AI测试任务失败:`, error);
    const errorText = `❌ AI测试失败\n\n原因: ${error.message}`;
    if (notificationMsgId) {
      await TelegramAPI.editMessageText(chatId, notificationMsgId, errorText);
    } else {
      await TelegramAPI.sendMessage(chatId, errorText, { reply_to_message_id: msg.message_id });
    }
  }
}


// 定义CORS响应头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*', // 允许所有头部，增强兼容性
};

export default {
  async fetch(request, env, ctx) {
    // 直接处理CORS预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Expected POST', { status: 405, headers: corsHeaders });
    }

    try {
      // 初始化配置
      initConfig(env);
      const kv = env[CONFIG.KV_NAMESPACE];

      if (!kv) {
        console.error("KV Namespace未绑定");
        return new Response('KV Namespace not configured', { status: 500, headers: corsHeaders });
      }
      
      const body = await request.json();
      
      switch (body.type) {
        case 'ai_scan':
          ctx.waitUntil(handleAIScan(body.data, kv));
          break;
        case 'ai_test':
          ctx.waitUntil(handleAITest(body.data, kv));
          break;
        default:
          return new Response('Unknown task type', { status: 400, headers: corsHeaders });
      }

      // 立即返回成功响应给主Worker，并附带CORS头
      return new Response(JSON.stringify({ success: true, message: "Task received" }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (error) {
      console.error('AI Worker处理失败:', error);
      return new Response(error.message, { status: 500, headers: corsHeaders });
    }
  }
};