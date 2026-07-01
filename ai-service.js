/**
 * AI 服务模块 - 按开放小说创作助手 Skill 规范重构
 * 工作流：设定 → 大纲 → 章节Spec → 正文生成 → 评审 → 修订
 */

const AIService = {
    PRESETS: {
        deepseek: {
            name: 'DeepSeek',
            endpoint: 'https://api.deepseek.com/v1/chat/completions',
            model: 'deepseek-chat',
            headers: (key) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }),
            versions: [
                { id: 'deepseek-chat', label: 'V3 (deepseek-chat) - 通用对话', desc: '性价比高，适合日常创作' },
                { id: 'deepseek-reasoner', label: 'R1 (deepseek-reasoner) - 深度推理', desc: '逻辑严密，适合大纲规划' },
                { id: 'deepseek-v4-flash', label: 'V4-Flash - 极速版', desc: '响应极快，适合批量生成' },
                { id: 'deepseek-v4-pro', label: 'V4-Pro - 旗舰版', desc: '最强性能，适合精雕细琢' }
            ]
        },
        openai: {
            name: 'OpenAI GPT', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o',
            headers: (key) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }),
            versions: [
                { id: 'gpt-4o', label: 'GPT-4o - 旗舰多模态', desc: '最新旗舰' },
                { id: 'gpt-4o-mini', label: 'GPT-4o Mini - 轻量版', desc: '快速便宜' },
                { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', desc: '经典旗舰' },
                { id: 'o3-mini', label: 'o3-mini - 推理专家', desc: '深度推理' }
            ]
        },
        claude: {
            name: 'Claude', endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-3-5-sonnet-20241022',
            headers: (key) => ({ 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
            versions: [
                { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', desc: '平衡性能与速度' },
                { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', desc: '响应最快' },
                { id: 'claude-opus-4-20250514', label: 'Claude Opus 4', desc: '最强性能' }
            ]
        },
        qwen: {
            name: '通义千问', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus',
            headers: (key) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }),
            versions: [
                { id: 'qwen-plus', label: 'Qwen-Plus', desc: '综合性能好' },
                { id: 'qwen-max', label: 'Qwen-Max', desc: '最强能力' },
                { id: 'qwen-turbo', label: 'Qwen-Turbo', desc: '速度优先' },
                { id: 'qwen-flash', label: 'Qwen-Flash', desc: '最快响应' }
            ]
        },
        glm: {
            name: '智谱 GLM', endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash',
            headers: (key) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }),
            versions: [
                { id: 'glm-4-flash', label: 'GLM-4-Flash', desc: '免费额度' },
                { id: 'glm-4-plus', label: 'GLM-4-Plus', desc: '性能更强' },
                { id: 'glm-4-air', label: 'GLM-4-Air', desc: '极致性价比' }
            ]
        },
        custom: {
            name: '自定义API', endpoint: '', model: '',
            headers: (key) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }),
            versions: []
        }
    },

    // ============ 核心 API 调用 ============
    getActiveConfig() {
        const model = Storage.getActiveModel();
        if (!model) return null;
        // 兼容 app.js 中的字段名：url/model/provider 和 ai-service 中的 endpoint/modelName/type
        const endpoint = model.url || model.endpoint || '';
        const modelName = model.model || model.modelName || '';
        const apiKey = model.apiKey || '';
        const type = model.provider || model.type || 'custom';
        return { endpoint, modelName, apiKey, type };
    },

    obfuscateKey(key) {
        const salt = 'novel_app_salt_2024'; let result = '';
        for (let i = 0; i < key.length; i++) result += String.fromCharCode(key.charCodeAt(i) ^ salt.charCodeAt(i % salt.length));
        return btoa(result);
    },

    deobfuscateKey(obfuscated) {
        try {
            const salt = 'novel_app_salt_2024'; const decoded = atob(obfuscated); let result = '';
            for (let i = 0; i < decoded.length; i++) result += String.fromCharCode(decoded.charCodeAt(i) ^ salt.charCodeAt(i % salt.length));
            return result;
        } catch { return ''; }
    },

    async callAPI(messages, options = {}) {
        const config = this.getActiveConfig();
        if (!config) throw new Error('请先配置AI模型和API密钥');
        const { temperature = 0.8, maxTokens = 4096, timeout = 120000 } = options;
        let requestBody, headers;

        if (config.type === 'claude') {
            const sys = messages.find(m => m.role === 'system');
            const chat = messages.filter(m => m.role !== 'system');
            requestBody = { model: config.modelName, max_tokens: maxTokens, temperature, system: sys?.content || '', messages: chat.map(m => ({ role: m.role, content: m.content })) };
            headers = { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' };
        } else {
            requestBody = { model: config.modelName, messages, temperature, max_tokens: maxTokens, stream: false };
            headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` };
        }

        // 超时控制：使用 AbortController
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(config.endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(`API调用失败: ${err.error?.message || err.message || `HTTP ${response.status}`}`);
            }
            const data = await response.json();
            return config.type === 'claude' ? (data.content?.[0]?.text || '') : (data.choices?.[0]?.message?.content || '');
        } catch (e) {
            if (e.name === 'AbortError') {
                throw new Error(`AI调用超时（${timeout / 1000}秒），请检查网络或稍后重试`);
            }
            throw e;
        } finally {
            clearTimeout(timeoutId);
        }
    },

    // ============ 模块1: 设定管理 ============
    async generateSetting(bookId, userInput = '') {
        const ctx = Storage.buildContextMemory(bookId);
        const book = Storage.getBook(bookId);
        const plans = Storage.getPlans(bookId);
        const sys = this._getSettingSystemPrompt();
        let user = `## 故事背景\n${ctx}\n\n`;
        user += `请为小说《${book?.name || ''}》扩展世界观设定。\n\n`;
        if (book?.setting) user += `## 已有初始设定\n${book.setting}\n`;
        if (plans.setting) user += `\n## 已有扩展设定（请在此基础上补充，不要重复）\n${plans.setting}\n`;
        if (userInput) user += `\n## 用户的构想\n${userInput}\n`;
        user += `\n请扩展：世界观细节、势力分布、人物关系网络、伏笔线索。输出格式：\n# 世界观设定\n\n## 世界地理与历史\n...\n\n## 力量/科技体系\n...\n\n## 势力分布\n...\n\n## 人物关系网络\n...\n\n## 伏笔与线索\n...`;
        return await this.callAPI([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.7, maxTokens: 4096 });
    },

    // ============ 模块2: 大纲生成 ============
    async generateOutline(bookId, userInput = '', focus = '均衡') {
        const ctx = Storage.buildContextMemory(bookId);
        const book = Storage.getBook(bookId);
        const plans = Storage.getPlans(bookId);
        const sys = this._getOutlineSystemPrompt();
        let user = `## 故事背景\n${ctx}\n\n`;
        user += `请为小说《${book?.name || ''}》规划故事大纲。\n`;
        if (book?.setting) user += `\n## 世界观设定\n${book.setting}\n`;
        if (plans.setting) user += `\n## 扩展设定\n${plans.setting}\n`;
        if (plans.outline) user += `\n## 已有大纲（请在此基础上扩展细化）\n${plans.outline}\n`;
        if (userInput) user += `\n## 用户的构想\n${userInput}\n`;
        user += `\n## 侧重方向：${focus}\n`;
        user += `\n请输出完整大纲结构：\n# 故事大纲\n\n## 核心设定（一句话卖点）\n...\n\n## 主线（起承转合四段）\n...\n\n## 支线\n...\n\n## 人物弧光\n...\n\n## 高潮/结局设计\n...`;
        return await this.callAPI([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.7, maxTokens: 4096 });
    },

    // ============ 模块3: 章节Spec生成 ============
    async generateChapterSpec(bookId, chapterOrder) {
        const ctx = Storage.buildContextMemory(bookId, { chapterOrder });
        const book = Storage.getBook(bookId);
        const plans = Storage.getPlans(bookId);
        const prevSpecs = Storage.getRecentChapterSpecs(bookId, 3);

        const sys = this._getSpecSystemPrompt();
        let user = `请为小说《${book?.name || ''}》第${chapterOrder}章生成章节规格（Spec）。\n\n`;
        user += `## 完整故事背景\n${ctx}\n`;
        if (plans.outline) user += `\n## 故事大纲（确保本章在整体结构中位置正确）\n${plans.outline}\n`;
        if (plans.setting) user += `\n## 世界观设定\n${plans.setting}\n`;
        if (prevSpecs) user += `\n## 前3章规格（用于连贯性参考）\n${prevSpecs}\n`;
        user += `\n请输出YAML格式的章节规格：\n\`\`\`yaml\nchapter: ${chapterOrder}\ntitle: "章节标题"\nsummary: "200字以内摘要"\n\nbefore_state:\n  characters:\n    - {name: "角色名", state: "当前状态", location: "位置"}\n  plot_hooks: ["未回收的伏笔"]\n\nafter_state:\n  characters:\n    - {name: "角色名", state: "新状态", location: "新位置"}\n  plot_advances: ["回收的伏笔", "新埋的伏笔"]\n\nmust_happen:\n  - "必须发生的关键事件1"\n  - "必须发生的关键事件2"\n\ntension_curve:\n  - {position: 0, value: 3, note: "开篇铺垫"}\n  - {position: 50, value: 8, note: "高潮"}\n  - {position: 100, value: 5, note: "收尾"}\n\nkey_scenes:\n  - "关键场景1"\n  - "关键场景2"\n\nnew_hooks:\n  - "本章新埋的结尾钩子"\n\`\`\``;
        return await this.callAPI([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.6, maxTokens: 3072 });
    },

    // ============ 模块4: 正文生成（基于Spec） ============
    async generateChapterContent(bookId, chapterOrder, spec, prompt = '', wordCount = null) {
        const ctx = Storage.buildContextMemory(bookId, { chapterOrder });
        const book = Storage.getBook(bookId);
        const prevContent = Storage.getPreviousChapterContent(bookId, chapterOrder);
        const plans = Storage.getPlans(bookId);

        // 获取前后章节摘要，增强连贯性感知
        const memory = Storage.getMemory(bookId);
        let surroundingContext = '';
        if (memory && memory.chapterSummaries && memory.chapterSummaries.length > 0) {
            const summaries = memory.chapterSummaries;
            const prevSummary = summaries.find(s => s.order === chapterOrder - 1);
            const nextSummary = summaries.find(s => s.order === chapterOrder + 1);
            if (prevSummary) surroundingContext += `## 上一章摘要\n第${prevSummary.order}章：${prevSummary.summary}\n`;
            if (nextSummary) surroundingContext += `## 下一章摘要（提前知道方向）\n第${nextSummary.order}章：${nextSummary.summary}\n`;
        }

        const wordRange = wordCount ? `字数${wordCount}字左右` : '字数3000-5000字';

        const sys = this._getWriterSystemPrompt();
        let user = `## 创作背景（全书记忆，用于确保人物/伏笔/剧情连贯）\n${ctx}\n\n`;
        user += `请基于以下章节规格（Spec）生成第${chapterOrder}章正文。\n\n`;
        user += `## 章节规格\n${spec}\n`;
        if (prevContent) user += `\n## 前文章节结尾（确保连贯衔接）\n${prevContent}\n`;
        if (surroundingContext) user += `\n## 前后章节上下文\n${surroundingContext}\n`;
        if (plans.setting) user += `\n## 世界观参考\n${plans.setting}\n`;
        if (plans.outline) user += `\n## 故事大纲（确保本章推进方向正确）\n${plans.outline}\n`;
        if (prompt) user += `\n## 额外指示\n${prompt}\n`;
        user += `\n## 连贯性要求\n这是第${chapterOrder}章。请确保：\n`;
        user += `- 开篇与上一章结尾**无缝衔接**（场景、人物位置、时间线一致）\n`;
        user += `- 结尾设置有力的悬念钩子，吸引读者继续阅读下一章\n`;
        user += `- 严格按照规格中的before_state/after_state/must_happen/key_scenes来写\n`;
        user += `\n${wordRange}。`;

        const content = await this.callAPI([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.85, maxTokens: 8192 });

        // 自动更新记忆
        Storage.autoUpdateMemory(bookId, `第${chapterOrder}章`, content, chapterOrder);

        return content;
    },

    // ============ 模块5: 评审反馈 ============
    async reviewChapter(bookId, chapterContent, chapterTitle) {
        const ctx = Storage.buildContextMemory(bookId);
        const sys = this._getReviewSystemPrompt();
        
        // 程序化矛盾检测
        const chapterOrder = parseInt(chapterTitle.match(/\d+/)?.[0] || '0');
        let contradictionNote = '';
        if (chapterOrder > 1) {
            const check = Storage.detectContradictions(bookId, chapterContent, chapterOrder);
            if (check.hasIssues) {
                contradictionNote = `\n\n## ⚠️ 程序化矛盾检测（请重点评审以下问题）\n`;
                check.issues.forEach((issue, i) => {
                    contradictionNote += `${i + 1}. [${issue.severity}] ${issue.type}\n   - 详情：${issue.detail}\n   - 建议：${issue.suggestion}\n`;
                });
            }
        }
        
        let user = `## 故事背景\n${ctx}\n\n`;
        user += `请评审以下章节。\n\n## 章节信息\n标题：${chapterTitle}\n\n## 待评审正文\n${chapterContent}${contradictionNote}\n\n请给出五维度评分、P0红线检查结果、总分和修改建议。`;
        return await this.callAPI([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.4, maxTokens: 3072 });
    },

    // ============ AI 改写 ============
    async reviseContent(bookId, originalContent, feedback) {
        const ctx = Storage.buildContextMemory(bookId);
        const sys = `你是专业小说编辑，根据反馈改写内容。仅修改反馈指出的问题，保持风格和人物一致。输出完整修改后正文，不要加解释。`;
        const user = `## 故事背景\n${ctx}\n\n## 原文\n${originalContent}\n\n## 修改要求\n${feedback}\n\n请输出修改后的完整正文。`;
        // ctx 已在 user message 中，不破坏 System Prompt 缓存
        return await this.callAPI([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.6, maxTokens: Math.max((originalContent.length || 2000) * 2, 4096) });
    },

    // ============ 模块6: 自动化推进 ============
    async autoWriteChapter(bookId, chapterOrder, wordCount = 3000) {
        // Step 1: 生成Spec
        const spec = await this.generateChapterSpec(bookId, chapterOrder);

        // Step 2: 基于Spec生成正文（内部已调用autoUpdateMemory）
        const content = await this.generateChapterContent(bookId, chapterOrder, spec);

        // Step 3: 评审
        const review = await this.reviewChapter(bookId, content, `第${chapterOrder}章`);

        // Step 4: 检查是否需要修订
        const score = this._parseReviewScore(review);
        const hasP0 = this._checkP0Issues(review);

        let finalContent = content;
        let revisionCount = 0;
        const MAX_REVISIONS = 2;

        while ((score < 85 || hasP0) && revisionCount < MAX_REVISIONS) {
            revisionCount++;
            const revisionPrompt = this._buildRevisionPrompt(review, hasP0);
            finalContent = await this.reviseContent(bookId, finalContent, revisionPrompt);
            const reReview = await this.reviewChapter(bookId, finalContent, `第${chapterOrder}章（修订${revisionCount}）`);
            const newScore = this._parseReviewScore(reReview);
            const newHasP0 = this._checkP0Issues(reReview);
            if (newScore >= 85 && !newHasP0) break;
        }

        return {
            spec, content: finalContent, review,
            revisionCount,
            finalScore: this._parseReviewScore(review),
            passed: score >= 85 && !hasP0
        };
    },

    _parseReviewScore(review) {
        const match = review.match(/总分[：:]\s*(\d+)/) || review.match(/最终得分[：:]\s*(\d+)/);
        return match ? parseInt(match[1]) : 80;
    },

    _checkP0Issues(review) {
        const p0Patterns = ['众所周知', '不言而喻', '总而言之', '他明白了', '她终于懂得', '真是太', '多么', '所有人没想到', '谁也不知道'];
        return p0Patterns.some(p => review.includes(p));
    },

    _buildRevisionPrompt(review, hasP0) {
        let p = '请根据以下评审意见修订本章内容：\n\n';
        p += review.substring(0, 1500);
        if (hasP0) p += '\n\n特别注意：必须消除所有P0红线问题（AI套话、感悟式结尾、上帝视角等）。';
        return p;
    },

    // ============ 测试连接 ============
    async testConnection(modelConfig) {
        const preset = this.PRESETS[modelConfig.type];
        const endpoint = modelConfig.endpoint || preset.endpoint;
        const modelName = modelConfig.modelName || preset.model;
        try {
            let requestBody, headers;
            if (modelConfig.type === 'claude') {
                requestBody = { model: modelName, max_tokens: 50, messages: [{ role: 'user', content: 'Hi' }] };
                headers = { 'Content-Type': 'application/json', 'x-api-key': modelConfig.apiKey, 'anthropic-version': '2023-06-01' };
            } else {
                requestBody = { model: modelName, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 50 };
                headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${modelConfig.apiKey}` };
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            try {
                const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(requestBody), signal: controller.signal });
                if (response.ok) return { success: true, message: '连接成功' };
                const err = await response.json().catch(() => ({}));
                return { success: false, message: err.error?.message || err.message || `HTTP ${response.status}` };
            } catch (fetchErr) {
                if (fetchErr.name === 'AbortError') {
                    return { success: false, message: '连接超时（15秒），请检查API地址' };
                }
                throw fetchErr;
            } finally {
                clearTimeout(timeoutId);
            }
        } catch (err) {
            if (err.message.includes('Failed to fetch')) return { success: false, message: '网络请求失败：可能是CORS跨域限制' };
            return { success: false, message: `连接异常: ${err.message}` };
        }
    },

    // ============ System Prompts ============

    // 固化 System Prompt —— 完全不变的写作原则，利用 DeepSeek 前缀缓存
    _getWriterSystemPrompt() {
        return `你是一位专业中文小说作家，擅长高质量长篇创作。

## 故事内核（最重要）
**苦难是艺术的温床。故事的终极底色是悲剧与遗憾。**
可以写欢乐，但欢乐是铺垫——是为了让之后的落差更大、遗憾更深。先给希望再夺走，先给温暖再冷却，先给信任再背叛。反差越大，悲剧越有力量。表达必须高级——不是刻意卖惨，而是润物细无声地让遗憾渗透在每一个情节转折中。

### 遗憾的四十种形态（创作时可参考融入，但不要直接套用）
1. 至始至终无人知晓的自我牺牲
2. 刚刚获得便又马上失去的希望
3. 至死都未能解开的惨痛误会
4. 已经找不到道歉对象的愧疚
5. 只差一点就能避免的永远错过
6. 一直被当成是谎言的诚恳坦白
7. 还没来得及公开就已结束的恋情
8. 在对方眼中不值一提的重大付出
9. 即使说出口也已经没用了的事实真相
10. 无论怎么选都是错的魔鬼抉择
11. 很久之后才知道自己当初真正失去了什么
12. 始终牢记的人早把自己忘了
13. 初衷便是欺骗的虚假情谊
14. 看似还有希望之时其实已经没有希望了
15. 原来很在意的愿望在达成时早就不在意了
16. 自己于在意之人眼中并无特别
17. 两人的约定只有一个人记得
18. 两人共同的誓言只有一个人遵守
19. 只差一步便能挽回的糟糕局面
20. 满腔怨怒委屈却找不到可以为之负责的对象
21. 不懂真正代价的糊涂交换
22. 两人间无能为力的渐行渐远
23. 情愿自我欺骗也不愿正视的真相
24. 转瞬即逝的人生巅峰
25. 身处热闹的极端孤独
26. 因为再没有什么期待才表现出的释然
27. 没有其他选择而不得不接受的结果
28. 无论如何都得不到认可的努力
29. 两人最后都没等到对方的道歉
30. 走到终点才发现路一开始便选错了
31. 见识过光明之后却得继续忍受黑暗
32. 维系情谊的脆弱平衡遭到破坏且无法修复
33. 不被感激反被误解与嫌弃的善意
34. 都为对方好但却不知道对方真正想要什么
35. 自己的痛苦在对方眼中只是好玩的笑话
36. 发现并没有人真的站在自己这边
37. 造成更加严重后果的善意欺骗
38. 爱恋产生的基础一开始就不存在
39. 怨恨产生的基础一开始也不存在
40. 从未真正拥有过失去后会令人痛苦的东西

### 悲剧表达原则
- **反差法则**：先给温暖再冷却，先给希望再夺走，先给信任再背叛。欢乐是铺垫，落差才是目的
- **不要刻意**：不写"他哭了""她好惨"这种直白表达，让读者自己品出悲剧
- **用行动代替情绪**：不写"他很悲伤"，写"他把那封信折了又折，最终放回了抽屉最深处"
- **用细节传递遗憾**：一个没送出的礼物、一条没回复的消息、一个再也打不通的号码
- **让日常承载重量**：最深的悲剧往往发生在最平常的时刻——一个人吃饭多摆了一副碗筷
- **不要美好结局**：每个胜利背后要有代价，每个获得背后要有失去

## 写作原则
### 声音：叙事者有态度和温度，不是冷冰冰的记录
### 层次：情绪有起伏变化，节奏张弛有度
### 细节：动作具体化，多感官描写（视觉、听觉、触觉、嗅觉、味觉）
### 呼吸：长短句交替使用，张弛有度
### 活性：动词要有力量，减少不必要的"的""了""着"

## 章节结尾（P0 强制要求）
- **每章结尾必须留强钩子**，让读者产生"立刻想看下一章"的冲动
- 钩子类型：悬念揭晓一半、危机突然降临、人物做出意外决定、新角色神秘登场、伏笔露出冰山一角
- 禁止平淡收尾：禁止"他转身离开了""夜渐渐深了"等无张力结尾
- 结尾要有"未完待续"的强烈暗示，但不能直接写"欲知后事如何"

## 对话规范（P0 强制要求）
- **所有对话必须符合人物性格和身份**，每个人物说话方式应独一无二
- 禁止所有角色说话风格雷同——老板说话要有老板的样子，小混混要有小混混的语气
- 禁止不符合人物身份的台词：村妇不能说文言文，古代人不能说网络用语，小孩不能长篇大论讲道理
- 对话应推动剧情或展现人物性格，禁止无意义的寒暄
- 每个角色的台词应能"听声辨人"——不看名字也知道是谁在说话

## 红线规则（P0 绝对禁止）
- 禁止"众所周知""不言而喻""总而言之"等AI套话
- 禁止感悟式结尾："他明白了...""她终于懂得..."
- 禁止感叹式结尾："真是太...""多么..."
- 禁止上帝视角："所有人没想到的是...""谁也不知道的是..."
- 禁止"在...的过程中""进行...的工作"等僵硬表达
- **禁止欢乐结局和刻意卖惨**：不要大团圆，也不要哭天喊地

## 输出格式（必填，在正文末尾用以下标记）
【摘要】本章50字以内摘要（必须包含核心事件+人物状态变化）
【新人物】本章新出场人物，每行一个，格式：角色名：简短描述（身份+性格特征）
【新伏笔】本章新埋的伏笔，每行一个
【已回收伏笔】本章回收的旧伏笔，每行一个
【人物关系变化】本章人物关系变化，每行格式：角色A-角色B：关系变化描述
【世界状态变化】本章全局性变化，每行格式：变化项：变化描述`;
    },

    _getOutlineSystemPrompt() {
        return `你是专业小说结构规划师。

## 大纲结构
1. 核心设定（一句话卖点）
2. 主线（起承转合四段结构）
3. 支线（辅助主线的次要情节）
4. 人物弧光（主角的成长变化）
5. 高潮/结局设计`;
    },

    _getSettingSystemPrompt() {
        return `你是世界观设定专家。

## 设定扩展方向
1. 世界地理与历史
2. 力量体系/科技体系
3. 势力分布与关系
4. 人物关系网络
5. 伏笔与线索设计`;
    },

    _getSpecSystemPrompt() {
        return `你是专业小说章节规划师。根据故事大纲、前文状态和人物弧光，为指定章节生成精确的规格（Spec）。

## Spec 字段说明
- before_state: 本章开始时的人物状态和未回收伏笔
- after_state: 本章结束后的人物新状态和伏笔变化
- must_happen: 本章必须发生的关键事件（推动剧情）
- tension_curve: 本章张力曲线（0-10值，position是百分比位置）
- key_scenes: 关键场景描述
- new_hooks: 章末钩子（吸引读者继续读）

## 连贯性要求
- 人物状态必须与前章一致
- 伏笔回收要合理
- 时间线不能冲突`;
    },

    _getReviewSystemPrompt() {
        return `你是资深小说编辑，从五个维度评审小说章节：

### 评审维度
| 角色 | 关注点 | 权重 |
|-----|-------|-----|
| 阅读者 | 开篇吸引力、节奏、画面感、**章末钩子强度** | 25% |
| 编审 | 错别字、病句、一致性、**对话是否符合人物身份** | 25% |
| 故事家 | 剧情逻辑、伏笔、钩子 | 25% |
| 文学顾问 | 语言艺术、人物刻画、**人物对话辨识度** | 15% |
| 毒舌读者 | 套路化、水文、毒点 | 10% |

### 评分标准
- 90-100：精品
- 85-89：优秀，可发布
- 75-84：良好，小改可发
- 60-74：合格，需修改
- 60以下：不合格，重写

### P0 红线检查（必须检查）
- **章末钩子**：结尾是否有强烈悬念？如果平淡收尾 → P0 问题
- **对话人设**：每个人的台词是否符合其身份性格？有没有"所有人说话一个样"？→ P0 问题
- AI套话词汇："众所周知""不言而喻""总而言之"
- 感悟式/感叹式结尾
- 上帝视角
- 抄袭嫌疑

请输出格式：
\`\`\`
## 评审报告

| 角色 | 评分 | 说明 |
|-----|------|------|
| 阅读者 | XX/100 | ... |
| 编审 | XX/100 | ... |
| 故事家 | XX/100 | ... |
| 文学顾问 | XX/100 | ... |
| 毒舌读者 | XX/100 | ... |

总分：XX/100

### P0红线检查
- [ ] AI套话词汇：无/有（列出）
- [ ] 感悟式结尾：无/有
- [ ] 上帝视角：无/有

### 改进建议
1. ...
2. ...
\`\`\``;
    }
};
