/**
 * 灵墨对话 - AI引导式创作入口
 * 用户从模糊想法开始，AI逐步引导理解，最终自动创建书籍
 */

const Brainstorm = {
    state: {
        messages: [],       // 对话消息
        step: 'greeting',   // greeting | asking | confirming | done
        extracted: {        // AI提取的书籍信息
            name: '',
            genre: '',
            desc: '',
            setting: '',
            keyElements: []  // 关键元素
        },
        questionCount: 0,
        createdBookId: null
    },

    // ============ 初始化 ============
    init() {
        // 如果已经有消息历史，不清空（避免切换tab丢失对话）
        if (this.state.messages.length === 0) {
            this.state.step = 'greeting';
            this.state.extracted = { name: '', genre: '', desc: '', setting: '', keyElements: [] };
            this.state.questionCount = 0;
            this.state.createdBookId = null;

            // 第一轮：AI主动打招呼
            this._addMessage('ai', `嗨！我是灵墨，你的AI创作伙伴。🎨

你不用想得很清楚，只要告诉我——**你脑海里那个模糊的故事感觉是什么样的？**

比如：
• "我想写一个关于复仇的故事"
• "一个少年在末世中求生的故事"
• "就是感觉很热血的那种修仙"
• "还没想好，就是想写点什么"

随便说，哪怕一个词也行。`, true);
        }

        this._render();
    },

    // ============ 添加消息 ============
    _addMessage(role, content, animate = false) {
        this.state.messages.push({
            role,
            content,
            animate,
            time: new Date().toISOString()
        });
    },

    // ============ 渲染 ============
    _render() {
        const container = document.getElementById('chatMessages');
        if (!container) return;

        // 保留空状态元素
        const emptyEl = document.getElementById('chatEmpty');
        
        let html = '';

        this.state.messages.forEach((msg, i) => {
            if (msg.role === 'ai') {
                // AI 消息：带头像
                html += `<div class="msg-row ai">
                    <div class="msg-avatar ai-avatar">
                        <svg width="22" height="22" viewBox="0 0 48 48"><path fill="currentColor" d="M31.833 13.112a5.36 5.36 0 0 0-2.544-1.805l-2.603-.845a1.028 1.028 0 0 1 0-1.937l2.602-.845a5.36 5.36 0 0 0 3.323-3.33l.022-.064l.845-2.6a1.027 1.027 0 0 1 1.94 0l.845 2.6A5.36 5.36 0 0 0 39.66 7.68l2.602.845l.052.013a1.028 1.028 0 0 1 0 1.937l-2.602.845a5.36 5.36 0 0 0-3.397 3.394l-.846 2.6l-.025.064a1.027 1.027 0 0 1-1.538.433a1.03 1.03 0 0 1-.375-.497l-.846-2.6a5.4 5.4 0 0 0-.852-1.602m14.776 6.872l-1.378-.448a2.84 2.84 0 0 1-1.797-1.796l-.448-1.377a.544.544 0 0 0-1.027 0l-.448 1.377a2.84 2.84 0 0 1-1.77 1.796l-1.378.448a.545.545 0 0 0 0 1.025l1.378.448q.227.075.438.188l.003.015a2.84 2.84 0 0 1 1.357 1.61l.448 1.377a.545.545 0 0 0 1.01.039v-.01l.016-.039l.448-1.377a2.84 2.84 0 0 1 1.798-1.796l1.378-.448a.545.545 0 0 0 0-1.025zM29.93 5q.042-.039.081-.081A20 20 0 0 0 24 4C12.954 4 4 12.954 4 24c0 3.448.873 6.695 2.411 9.528L4.07 41.766c-.375 1.318.843 2.537 2.162 2.162l8.236-2.342A19.9 19.9 0 0 0 24 44c10.16 0 18.551-7.577 19.831-17.388A2.55 2.55 0 0 1 41 26.54a2.54 2.54 0 0 1-.89-1.35l-.44-1.37a.9.9 0 0 0-.2-.33a1 1 0 0 0-.2-.15l-.12-.06l-1.42-.46a2.55 2.55 0 0 1-1.7-2.4c0-.346.075-.687.22-1a3 3 0 0 1-3.47 0a3 3 0 0 1-1.12-1.51l-.84-2.59a3.2 3.2 0 0 0-.54-1A3 3 0 0 0 30 14a3.3 3.3 0 0 0-1.35-.79L26 12.35a3 3 0 0 1-1.44-4.58a3.1 3.1 0 0 1 1.51-1.12l2.57-.83A3.4 3.4 0 0 0 29.93 5"/></svg>
                    </div>
                    <div class="msg-bubble ai">${this._formatContent(msg.content)}</div>
                </div>`;
            } else {
                // 用户消息：头像在右边
                html += `<div class="msg-row user">
                    <div class="msg-bubble user">${msg.content}</div>
                    <div class="msg-avatar user-avatar">
                        <svg width="22" height="22" viewBox="0 0 24 24"><defs><linearGradient id="userGrad1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="var(--accent)"/><stop offset="100%" stop-color="var(--accent-strong)"/></linearGradient></defs><circle cx="12" cy="8" r="5" fill="url(#userGrad1)" opacity="0.9"/><path d="M4 22c0-4.418 3.582-8 8-8s8 3.582 8 8" fill="url(#userGrad1)" opacity="0.9"/></svg>
                    </div>
                </div>`;
            }
        });

        // 如果处于确认阶段，显示提取卡片
        if (this.state.step === 'confirming') {
            html += this._renderExtractCard();
        }

        container.innerHTML = html;
        if (emptyEl) emptyEl.style.display = 'none';
        container.scrollTop = container.scrollHeight;
    },

    _formatContent(text) {
        return text.replace(/\n/g, '<br>');
    },

    _renderExtractCard() {
        const e = this.state.extracted;
        return `<div class="bs-extract-card">
            <div class="bs-extract-header">
                <span class="bs-extract-icon">📖</span>
                <strong>我理解的你的故事：</strong>
            </div>
            <div class="bs-extract-body">
                ${e.name ? `<div class="bs-extract-row"><span>书名</span><span>${e.name}</span></div>` : ''}
                ${e.genre ? `<div class="bs-extract-row"><span>类型</span><span>${e.genre}</span></div>` : ''}
                ${e.desc ? `<div class="bs-extract-row"><span>简介</span><span>${e.desc}</span></div>` : ''}
                ${e.setting ? `<div class="bs-extract-row"><span>设定</span><span>${e.setting}</span></div>` : ''}
                ${e.keyElements.length > 0 ? `<div class="bs-extract-row"><span>关键元素</span><span>${e.keyElements.join('、')}</span></div>` : ''}
            </div>
        </div>`;
    },

    // ============ 用户发送消息 ============
    async send(userText) {
        // 支持两种调用方式：Brainstorm.send(text) 或 Brainstorm.send() (从DOM读取)
        const userMsg = (typeof userText === 'string' && userText.trim()) 
            ? userText.trim() 
            : (document.getElementById('chatInput')?.value || '').trim();
        
        if (!userMsg) return;

        // 检查是否配置了模型
        const activeModel = Storage.getActiveModel();
        if (!activeModel || !activeModel.apiKey) {
            this._addMessage('ai', '⚠️ **未连接AI模型**\n\n请先在「我的」→「模型管理」中添加并配置一个AI模型（API Key），然后再和我聊天哦~');
            this._render();
            return;
        }

        // 显示用户消息
        this._addMessage('user', userMsg);
        
        // 清空输入框
        const input = document.getElementById('chatInput');
        if (input) {
            input.value = '';
            input.style.height = 'auto';
        }
        this._render();

        // 滚动到底部
        const container = document.getElementById('chatMessages');
        if (container) container.scrollTop = container.scrollHeight;

        // 显示AI正在思考
        const thinkingId = 'thinking_' + Date.now();
        this._addMessage('ai', '<span class="msg-thinking">💭 灵墨正在思考...</span>', false);
        this._render();

        try {
            // 根据当前阶段调用不同的AI处理
            let response;
            if (this.state.step === 'confirming') {
                response = await this._handleConfirmation(userMsg);
            } else {
                response = await this._handleBrainstorm(userMsg);
            }

            // 移除思考消息，添加真实回复
            this.state.messages = this.state.messages.filter(m => !String(m.content).includes('msg-thinking'));
            this._addMessage('ai', response, true);
            this._render();
        } catch (e) {
            this.state.messages = this.state.messages.filter(m => !String(m.content).includes('msg-thinking'));
            console.error('[Brainstorm] 对话错误:', e);
            const errMsg = e.message || '未知错误';
            let errContent = '抱歉，我暂时无法回应。😔\n\n';
            if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError') || errMsg.includes('CORS')) {
                errContent += '**网络连接失败**：可能是API地址无法访问或存在跨域限制。\n请检查：\n• API地址是否正确\n• 网络是否通畅\n• 是否需要配置代理';
            } else if (errMsg.includes('401') || errMsg.includes('403')) {
                errContent += '**API密钥无效**：请检查模型配置中的API Key是否正确。';
            } else if (errMsg.includes('429')) {
                errContent += '**请求过于频繁**：API请求次数超限，请稍后再试。';
            } else if (errMsg.includes('500') || errMsg.includes('502') || errMsg.includes('503')) {
                errContent += '**服务器错误**：AI服务暂时不可用，请稍后再试。';
            } else {
                errContent += `**错误详情**：${errMsg}\n\n请检查模型配置和网络连接。`;
            }
            this._addMessage('ai', errContent, false);
            this._render();
        }
    },

    // ============ AI 头脑风暴处理 ============
    async _handleBrainstorm(userMsg) {
        this.state.questionCount++;

        // 构建对话历史
        const history = this.state.messages
            .filter(m => !String(m.content).includes('msg-thinking'))
            .map(m => `${m.role === 'ai' ? '灵墨' : '用户'}：${m.content.replace(/<[^>]+>/g, '')}`)
            .join('\n');

        const sysPrompt = `你是「灵墨」，一个AI小说创作引导助手。你的任务是：

## 核心目标
帮助用户从一个模糊的想法逐步清晰化，最终确定要写一个什么样的故事。

## 对话策略
1. **每轮最多问1-2个问题**，不要一口气问太多
2. **问题要具体**，帮助用户聚焦，不要问"你还想说什么"这种开放式问题
3. **根据用户回答深入追问**：
   - 如果用户说"复仇"→问"什么类型的复仇？个人恩怨还是家国大恨？"
   - 如果用户说"修仙"→问"喜欢传统修炼体系还是想创新？"
   - 如果用户说"热血"→问"想偏重战斗场面还是情感成长？"
4. **第3-5轮时开始提炼理解**："根据你说的，我理解你想写一个关于...的故事，对吗？"
5. **第5-8轮时进入确认阶段**：输出一个结构化的理解摘要

## 理解摘要格式（进入确认阶段时使用）
\`\`\`summary
书名建议：XXX
类型：XXX
一句话简介：XXX
世界观要点：XXX
关键元素：元素1、元素2、元素3
\`\`\`

## 规则
- 保持鼓励和支持的语气
- 不要替用户做决定，而是帮他发现自己的想法
- 用户说"不知道"时，给出2-3个具体选项让他选
- 回复简洁，100字以内
- 不要用markdown格式，用自然语言

## 当前状态
对话轮数：第${this.state.questionCount}轮
${this.state.questionCount >= 5 ? '提示：已经聊了5轮，如果用户想法已经足够清晰，可以尝试输出理解摘要进入确认阶段。' : ''}
${this.state.questionCount >= 8 ? '提示：必须输出理解摘要进入确认阶段。' : ''}

## 对话历史
${history}`;

        const messages = [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: '请根据对话历史继续引导用户。' }
        ];

        const response = await AIService.callAPI(messages, { temperature: 0.8, maxTokens: 800 });

        // 检查是否包含确认摘要
        if (response.includes('summary') || response.includes('书名建议') || this.state.questionCount >= 6) {
            this.state.step = 'confirming';
            const extracted = this._parseExtraction(response);
            if (extracted.name) {
                this.state.extracted = { ...this.state.extracted, ...extracted };
            }
            // 在回复末尾添加确认按钮引导
            return response + '\n\n---\n👆 如果觉得这个方向不错，回复"确认"我就帮你创建这本书。如果想调整，直接告诉我想改什么。';
        }

        return response;
    },

    _parseExtraction(text) {
        const result = { name: '', genre: '', desc: '', setting: '', keyElements: [] };
        const lines = text.split('\n');
        for (const line of lines) {
            const cleaned = line.replace(/[*#`-]/g, '').trim();
            if (cleaned.includes('书名') || cleaned.includes('名称')) {
                result.name = cleaned.split(/[：:]/)[1]?.trim() || '';
            } else if (cleaned.includes('类型') || cleaned.includes('分类')) {
                result.genre = cleaned.split(/[：:]/)[1]?.trim() || '';
            } else if (cleaned.includes('简介') || cleaned.includes('一句话')) {
                result.desc = cleaned.split(/[：:]/)[1]?.trim() || '';
            } else if (cleaned.includes('设定') || cleaned.includes('世界观')) {
                result.setting = cleaned.split(/[：:]/)[1]?.trim() || '';
            } else if (cleaned.includes('关键元素') || cleaned.includes('元素')) {
                const elems = cleaned.split(/[：:]/)[1]?.trim() || '';
                result.keyElements = elems.split(/[、,，]/).map(e => e.trim()).filter(e => e);
            }
        }
        return result;
    },

    // ============ 确认阶段处理 ============
    async _handleConfirmation(userMsg) {
        if (userMsg.includes('确认') || userMsg.includes('可以') || userMsg.includes('好') || userMsg.includes('行') || userMsg.includes('没问题') || userMsg.includes('ok') || userMsg.includes('OK')) {
            return await this._createBook();
        }
        // 用户想调整，继续引导
        this.state.step = 'asking';
        this.state.questionCount++;
        return await this._handleBrainstorm('我想调整一下：' + userMsg);
    },

    async _createBook() {
        // 构建完整对话历史，传给AI整理书籍信息
        const conversationHistory = this.state.messages
            .filter(m => !String(m.content).includes('msg-thinking'))
            .map(m => `${m.role === 'ai' ? '灵墨' : '用户'}：${m.content.replace(/<[^>]+>/g, '')}`)
            .join('\n');

        const e = this.state.extracted;

        // 用AI基于完整对话历史整理书籍信息
        const refinePrompt = `请根据以下对话历史，总结用户想写的小说，生成完整信息。只需输出JSON。

## 完整对话历史
${conversationHistory}

## AI的理解摘要
书名建议：${e.name || '未命名'}
类型：${e.genre || '未确定'}
简介：${e.desc || '暂无'}
设定：${e.setting || '暂无'}
关键元素：${e.keyElements.join('、') || '无'}

## 请根据以上对话历史和理解，输出JSON：
\`\`\`json
{
  "name": "书名（10字以内，根据对话提炼）",
  "genre": "类型（玄幻/仙侠/都市/科幻/悬疑/言情/历史/游戏/其他）",
  "desc": "一句话简介（50字以内，根据对话提炼）",
  "setting": "世界观设定（100字以内，根据对话提炼）"
}
\`\`\``;

        let bookInfo = { name: e.name || '未命名故事', genre: e.genre || '其他', desc: e.desc || '', setting: e.setting || '' };

        try {
            const jsonResponse = await AIService.callAPI([
                { role: 'system', content: '你是小说信息整理助手。根据完整对话历史提炼书籍信息，输出JSON。' },
                { role: 'user', content: refinePrompt }
            ], { temperature: 0.5, maxTokens: 500 });

            const jsonMatch = jsonResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                bookInfo = { ...bookInfo, ...parsed };
            }
        } catch {}

        // 创建书籍
        const book = Storage.addBook({
            name: bookInfo.name,
            genre: bookInfo.genre,
            desc: bookInfo.desc,
            setting: bookInfo.setting
        });

        this.state.createdBookId = book.id;

        return `太棒了！🎉 我已经帮你创建了《${book.name}》。

📖 **书名**：${book.name}
🏷️ **类型**：${book.genre}
📝 **简介**：${book.desc}

接下来你可以：
• 在**书架**中打开这本书开始阅读
• 进入**创作助手**继续完善设定和大纲
• 直接**新建章节**让AI帮你写正文

想做什么？`;
    },

    // ============ 跳转到书架 ============
    goToBookshelf() {
        if (this.state.createdBookId) {
            currentBookId = this.state.createdBookId;
            showBookDetail(this.state.createdBookId);
        } else {
            switchTab('bookshelf');
        }
    },

    // ============ 快捷入口 ============
    quickStart(idea) {
        this.send(idea);
    }
};
