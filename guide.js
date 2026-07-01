/**
 * 引导式创作助手 - 对话卡片交互
 * 核心理念：AI问→用户答→AI生成→用户审→迭代
 */

const Guide = {
    state: {
        bookId: null,
        step: 0,           // 当前步骤
        mode: '',           // setting | outline | chapter | review
        context: {},        // 对话上下文
        history: [],        // 对话历史
        choices: [],        // 当前选项
        generatedContent: '' // 上次生成的内容
    },

    /**
     * 启动引导流程
     */
    start(bookId, mode) {
        if (!bookId) { showToast('请先选择一本书'); return; }
        this.state.bookId = bookId;
        this.state.mode = mode;
        this.state.step = 0;
        this.state.context = {};
        this.state.history = [];
        this.state.choices = [];
        this.state.generatedContent = '';

        const book = Storage.getBook(bookId);
        const plans = Storage.getPlans(bookId);

        // 初始化上下文
        this.state.context = {
            bookName: book?.name || '',
            genre: book?.genre || '',
            bookDesc: book?.desc || '',
            bookSetting: book?.setting || '',
            hasSetting: !!plans.setting,
            hasOutline: !!plans.outline,
            chapterCount: Storage.getChapters(bookId).length
        };

        // 切换到引导页
        document.querySelectorAll('.screen').forEach(p => p.classList.remove('active'));
        const guidePage = document.getElementById('guidePage');
        if (guidePage) {
            guidePage.classList.add('active');
        } else {
            // 降级：在chatScreen中渲染引导内容
            document.getElementById('chatScreen').classList.add('active');
        }
        const navBack = document.getElementById('navBack') || document.getElementById('btnBack');
        if (navBack) navBack.style.display = '';
        document.getElementById('tbTitle').textContent = this._getTitle();
        const navAction = document.getElementById('navAction');
        if (navAction) navAction.style.display = 'none';

        // 渲染初始界面
        this._render();
    },

    _getTitle() {
        const titles = {
            setting: '设定引导', outline: '大纲·蓝图引导',
            chapter: '章节引导', review: '评审'
        };
        return titles[this.state.mode] || '创作助手';
    },

    // ============ 渲染 ============
    _render() {
        const container = document.getElementById('guideContent');
        const actions = document.getElementById('guideActions');

        if (this.state.step === 0) {
            // 第一步：展示欢迎信息和确认入口
            this._renderWelcome(container, actions);
        } else {
            // 后续步骤：根据模式渲染
            switch (this.state.mode) {
                case 'setting': this._renderSetting(container, actions); break;
                case 'outline': this._renderOutline(container, actions); break;
                case 'chapter': this._renderChapter(container, actions); break;
                case 'review': this._renderReview(container, actions); break;
            }
        }
    },

    // ============ 欢迎页 ============
    _renderWelcome(container, actions) {
        const ctx = this.state.context;
        let html = '<div class="guide-welcome">';

        if (this.state.mode === 'setting') {
            html += `
                <div class="guide-card">
                    <h3>📖 设定管理</h3>
                    <p>好的设定是故事的基石。我们先聊聊你想写什么样的世界。</p>
                </div>
                <div class="guide-card guide-info">
                    <p><strong>书名：</strong>${ctx.bookName}</p>
                    <p><strong>类型：</strong>${ctx.genre}</p>
                    ${ctx.bookSetting ? `<p class="guide-has-content">✓ 已有初始设定</p>` : '<p class="guide-no-content">暂未填写初始设定</p>'}
                    ${ctx.hasSetting ? '<p class="guide-has-content">✓ 已有扩展设定（AI可在其基础上补充）</p>' : ''}
                </div>
                <div class="guide-question">
                    <p>先从最核心的开始：<strong>你想构建一个怎样的世界？</strong></p>
                </div>`;
        } else if (this.state.mode === 'outline') {
            html += `
                <div class="guide-card">
                    <h3>📋 大纲·蓝图引导</h3>
                    <p>大纲决定了故事的方向和节奏，蓝图规划每章的路径。我们一步步来。</p>
                </div>
                <div class="guide-card guide-info">
                    <p><strong>书名：</strong>${ctx.bookName}</p>
                    ${ctx.hasSetting ? '<p class="guide-has-content">✓ 有扩展设定</p>' : '<p class="guide-warn">⚠ 建议先完善设定，再规划大纲</p>'}
                    ${ctx.hasOutline ? '<p class="guide-has-content">✓ 已有大纲（可在此基础上细化）</p>' : ''}
                </div>
                <div class="guide-question">
                    <p><strong>第一步：用一句话描述你的故事。</strong></p>
                    <p class="guide-hint">比如："一个被宗门抛弃的废柴少年，意外觉醒了上古血脉，从此踏上逆天之路。"</p>
                    <p class="guide-hint" style="margin-top:8px;color:var(--accent)">💡 提示：后续会问你计划写多少章、每章多少字，AI会根据章数自动规划阶段和章节蓝图。</p>
                </div>`;
        } else if (this.state.mode === 'chapter') {
            const nextNum = ctx.chapterCount + 1;
            html += `
                <div class="guide-card">
                    <h3>✍️ 第${nextNum}章引导</h3>
                    <p>先规划再动笔。我们会先讨论本章要写什么，确认后再让AI生成正文。</p>
                </div>
                <div class="guide-card guide-info">
                    <p><strong>书名：</strong>${ctx.bookName}</p>
                    <p><strong>进度：</strong>已写${ctx.chapterCount}章，即将开始第${nextNum}章</p>
                    ${ctx.hasOutline ? '<p class="guide-has-content">✓ 有大纲参考</p>' : ''}
                </div>
                <div class="guide-question">
                    <p><strong>第${nextNum}章你想写什么？</strong></p>
                    <p class="guide-hint">简单描述本章想推进的剧情，哪怕只有一句话。</p>
                </div>`;
        } else if (this.state.mode === 'review') {
            const chs = Storage.getChapters(ctx.bookId);
            const last = chs[chs.length - 1];
            html += `
                <div class="guide-card">
                    <h3>🔍 评审</h3>
                    <p>我会从五个维度审视你的文字，帮你发现问题。</p>
                </div>
                <div class="guide-card guide-info">
                    <p><strong>最新章节：</strong>${last?.title || '无'}</p>
                    <p><strong>字数：</strong>${(last?.content || '').length}字</p>
                </div>
                <div class="guide-question">
                    <p><strong>你想侧重检查哪些方面？</strong></p>
                </div>`;
        }

        html += '</div>';

        container.innerHTML = html;

        // 操作区：文本输入 + 确认按钮
        if (this.state.mode === 'review') {
            actions.innerHTML = `
                <div class="guide-choices">
                    <button class="guide-choice-btn" onclick="Guide._confirmStep('全部检查')">📊 全部检查</button>
                    <button class="guide-choice-btn" onclick="Guide._confirmStep('重点查AI套话')">🚫 重点查AI套话</button>
                    <button class="guide-choice-btn" onclick="Guide._confirmStep('重点查节奏和逻辑')">📈 重点查节奏逻辑</button>
                </div>
                <textarea class="guide-input" id="guideUserInput" placeholder="或者告诉我你想重点看什么..."></textarea>
                <button class="btn btn-primary btn-full" onclick="Guide._confirmStep()">开始评审 →</button>`;
        } else {
            actions.innerHTML = `
                <textarea class="guide-input" id="guideUserInput" placeholder="${this._getPlaceholder()}" rows="3"></textarea>
                <button class="btn btn-primary btn-full" onclick="Guide._confirmStep()">${this._getButtonLabel()} →</button>`;
        }
    },

    _getPlaceholder() {
        const map = {
            setting: '描述你心中的世界：时代背景、力量体系、势力分布...（一两句话即可）',
            outline: '用一句话概括你的故事，比如：一个XXX的人，在XXX情况下，做了XXX...',
            chapter: '本章想推进什么剧情？发生什么关键事件？'
        };
        return map[this.state.mode] || '说说你的想法...';
    },

    _getButtonLabel() {
        const map = {
            setting: 'AI帮我扩展设定', outline: 'AI帮我展开大纲·蓝图',
            chapter: 'AI帮我规划本章', review: '开始评审'
        };
        return map[this.state.mode] || '确认';
    },

    // ============ 确认用户输入，进入生成 ============
    async _confirmStep(presetAnswer) {
        const inputEl = document.getElementById('guideUserInput');
        const userInput = presetAnswer || (inputEl ? inputEl.value.trim() : '');

        if (!userInput && this.state.mode !== 'review') {
            showToast('请先说说你的想法');
            return;
        }

        // 保存用户输入到上下文
        this.state.history.push({ role: 'user', content: userInput });
        this.state.step = 1;

        // 显示加载
        document.getElementById('guideContent').innerHTML = `
            <div class="guide-card">
                <div class="guide-thinking">
                    <div class="loading-spinner"><div class="spinner"></div></div>
                    <p>${this._getThinkingText()}</p>
                </div>
            </div>`;
        document.getElementById('guideActions').innerHTML = '';

        try {
            switch (this.state.mode) {
                case 'setting':
                    await this._generateSetting(userInput);
                    break;
                case 'outline':
                    await this._generateOutline(userInput);
                    break;
                case 'chapter':
                    await this._generateChapter(userInput);
                    break;
                case 'review':
                    await this._runReview(userInput);
                    break;
            }
        } catch (e) {
            document.getElementById('guideContent').innerHTML = `
                <div class="guide-card guide-error">
                    <p>❌ 生成失败：${e.message}</p>
                </div>`;
            document.getElementById('guideActions').innerHTML = `
                <button class="btn btn-outline btn-full" onclick="Guide._goBack()">重新开始</button>
                <button class="btn btn-primary btn-full" onclick="Guide._retry()">重试</button>`;
        }
    },

    _getThinkingText() {
        const map = {
            setting: 'AI正在理解你的世界构想，生成设定建议...',
            outline: 'AI正在根据你的故事构思，规划大纲与章节蓝图...',
            chapter: 'AI正在分析前文，生成章节规划...',
            review: 'AI正在从五个维度评审...'
        };
        return map[this.state.mode] || 'AI思考中...';
    },

    // ============ 设定引导 ============
    async _generateSetting(userInput) {
        // Step 1: AI 先抛出几个方向性问题让用户思考
        const questions = await this._askSettingQuestions(userInput);

        document.getElementById('guideContent').innerHTML = `
            <div class="guide-card">
                <h3>🤔 AI 想确认几个问题</h3>
                <div class="guide-ai-questions">${questions}</div>
            </div>
            <div class="guide-card guide-hint-card">
                <p>💡 这是AI根据你的想法提出的澄清问题。<br>你可以回答其中一部分，也可以直接跳过。</p>
            </div>`;

        document.getElementById('guideActions').innerHTML = `
            <textarea class="guide-input" id="guideUserInput" placeholder="回答AI的问题，或者直接说'按你的理解来'..." rows="3"></textarea>
            <div class="guide-action-row">
                <button class="btn btn-outline" onclick="Guide._skipQuestions()">跳过，直接生成</button>
                <button class="btn btn-primary" onclick="Guide._answerQuestions()">确认并生成设定 →</button>
            </div>`;
    },

    async _askSettingQuestions(userInput) {
        const ctx = this.state.context;
        const prompt = `用户想写的小说基本信息：
书名：《${ctx.bookName}》 类型：${ctx.genre}
已有设定：${ctx.bookSetting || '无'}
用户的初步想法：${userInput}

请根据以上信息，提出3-4个关键问题来帮助用户明确世界观设定。
问题应聚焦于：时代背景、力量/科技体系、势力关系、独特卖点。
每个问题后面给出2-3个选项示例。
格式：每个问题一行，以"Q: "开头，选项以"- "开头。`;

        const messages = [
            { role: 'system', content: '你是专业小说设定顾问。帮助用户澄清世界观设定。' },
            { role: 'user', content: prompt }
        ];
        return await AIService.callAPI(messages, { temperature: 0.7, maxTokens: 1500 });
    },

    async _skipQuestions() {
        this.state.step = 2;
        document.getElementById('guideContent').innerHTML = `
            <div class="guide-card"><div class="guide-thinking">
                <div class="loading-spinner"><div class="spinner"></div></div>
                <p>AI正在生成完整设定...</p>
            </div></div>`;
        document.getElementById('guideActions').innerHTML = '';

        const userInput = this.state.history[0]?.content || '';
        const result = await AIService.generateSetting(this.state.bookId, userInput);
        this._showGeneratedResult('设定', result, 'setting');
    },

    async _answerQuestions() {
        const inputEl = document.getElementById('guideUserInput');
        const answer = inputEl ? inputEl.value.trim() : '按你的理解来';
        this.state.history.push({ role: 'user', content: answer });
        this.state.step = 2;

        document.getElementById('guideContent').innerHTML = `
            <div class="guide-card"><div class="guide-thinking">
                <div class="loading-spinner"><div class="spinner"></div></div>
                <p>AI正在根据你的回答生成设定...</p>
            </div></div>`;
        document.getElementById('guideActions').innerHTML = '';

        const fullInput = this.state.history.map(h => h.content).join('\n');
        const result = await AIService.generateSetting(this.state.bookId, fullInput);
        this._showGeneratedResult('设定', result, 'setting');
    },

    // ============ 大纲引导 ============
    async _generateOutline(userInput) {
        // Step 1: 确认一句话卖点
        const sellPoint = await this._generateSellPoint(userInput);

        document.getElementById('guideContent').innerHTML = `
            <div class="guide-card">
                <h3>💎 AI 提炼的核心卖点</h3>
                <div class="guide-sellpoint">${sellPoint}</div>
                <p class="guide-hint">如果这个卖点不够好，你可以直接修改。</p>
            </div>`;

        this.state.context.sellPoint = sellPoint;

        document.getElementById('guideActions').innerHTML = `
            <textarea class="guide-input" id="guideUserInput" placeholder="修改卖点，或者直接回车确认..." rows="2">${sellPoint}</textarea>
            <div class="guide-action-row">
                <button class="btn btn-outline" onclick="Guide._skipToFullOutline()">跳过，直接生成完整大纲</button>
                <button class="btn btn-primary" onclick="Guide._confirmSellPoint()">确认卖点，继续 →</button>
            </div>`;
    },

    async _generateSellPoint(userInput) {
        const ctx = this.state.context;
        const prompt = `书名：《${ctx.bookName}》 类型：${ctx.genre}
设定：${ctx.bookSetting || ''} 扩展设定：${Storage.getPlans(ctx.bookId).setting || ''}
用户想法：${userInput}

请用一句话概括这个故事的核心卖点（不超过50字）。
要能吸引读者，有冲突感和好奇心。直接输出卖点，不要解释。`;

        const messages = [
            { role: 'system', content: '你是资深小说策划，擅长提炼故事核心卖点。' },
            { role: 'user', content: prompt }
        ];
        return await AIService.callAPI(messages, { temperature: 0.8, maxTokens: 200 });
    },

    async _confirmSellPoint() {
        const inputEl = document.getElementById('guideUserInput');
        const sellPoint = inputEl ? inputEl.value.trim() : this.state.context.sellPoint;
        this.state.context.sellPoint = sellPoint;
        this.state.history.push({ role: 'user', content: '卖点确认：' + sellPoint });

        // Step 2: 询问章数和字数规划
        this.state.step = 2;
        document.getElementById('guideContent').innerHTML = `
            <div class="guide-card">
                <h3>📐 大纲·蓝图规划</h3>
                <p>为了让AI更好地规划故事结构和章节蓝图，请告诉我：</p>
                <div class="guide-structure">
                    <div class="guide-struct-item">🎯 <strong>核心卖点</strong>：${sellPoint}</div>
                    <div class="guide-struct-item">📈 <strong>主线</strong>：分阶段展开，每阶段明确章节范围</div>
                    <div class="guide-struct-item">🔀 <strong>支线</strong>：辅助情节</div>
                    <div class="guide-struct-item">👤 <strong>人物弧光</strong>：主角成长轨迹</div>
                    <div class="guide-struct-item">💥 <strong>爆点分布</strong>：小爆点→中爆点→大高潮→收束</div>
                </div>
                <div class="guide-question">
                    <p><strong>计划写多少章？每章大概多少字？侧重哪个方向？</strong></p>
                </div>
            </div>`;

        document.getElementById('guideActions').innerHTML = `
            <div class="guide-chapter-inputs" style="display:flex;gap:8px;margin-bottom:8px">
                <input type="text" class="guide-input" id="guideChapterCount" placeholder="总章数，如：100" style="flex:1">
                <input type="text" class="guide-input" id="guideChapterLength" placeholder="每章字数，如：3000-5000" style="flex:1">
            </div>
            <div class="guide-choices">
                <button class="guide-choice-btn" onclick="Guide._generateFullOutline('均衡')">📊 均衡发展</button>
                <button class="guide-choice-btn" onclick="Guide._generateFullOutline('人物成长为主')">👤 人物成长为主</button>
                <button class="guide-choice-btn" onclick="Guide._generateFullOutline('剧情反转为主')">🔄 剧情反转为主</button>
                <button class="guide-choice-btn" onclick="Guide._generateFullOutline('爽点密集')">⚡ 爽点密集</button>
            </div>`;
    },

    async _skipToFullOutline() {
        await this._generateFullOutline('均衡');
    },

    async _generateFullOutline(focus) {
        // 读取章数和字数输入
        const chapterCountEl = document.getElementById('guideChapterCount');
        const chapterLengthEl = document.getElementById('guideChapterLength');
        const chapterCount = chapterCountEl ? chapterCountEl.value.trim() : '';
        const chapterLength = chapterLengthEl ? chapterLengthEl.value.trim() : '';
        
        let extraInfo = '侧重方向：' + focus;
        if (chapterCount) extraInfo += '，总章数：' + chapterCount + '章';
        if (chapterLength) extraInfo += '，每章字数：' + chapterLength + '字';
        
        this.state.history.push({ role: 'user', content: extraInfo });
        document.getElementById('guideContent').innerHTML = `
            <div class="guide-card"><div class="guide-thinking">
                <div class="loading-spinner"><div class="spinner"></div></div>
                <p>AI正在生成完整大纲·蓝图${chapterCount ? '（' + chapterCount + '章规模）' : ''}...</p>
            </div></div>`;
        document.getElementById('guideActions').innerHTML = '';

        const fullInput = this.state.history.map(h => h.content).join('\n');
        const result = await AIService.generateOutline(this.state.bookId, fullInput, focus);
        this._showGeneratedResult('大纲·蓝图', result, 'outline');
    },

    // ============ 章节引导 ============
    async _generateChapter(userInput) {
        const chNum = this.state.context.chapterCount + 1;

        // Step 1: 先生成Spec，让用户审阅
        document.getElementById('guideContent').innerHTML = `
            <div class="guide-card"><div class="guide-thinking">
                <div class="loading-spinner"><div class="spinner"></div></div>
                <p>AI正在分析前文，生成第${chNum}章规划...</p>
            </div></div>`;
        document.getElementById('guideActions').innerHTML = '';

        const spec = await AIService.generateChapterSpec(this.state.bookId, chNum);
        this.state.generatedContent = spec;
        Storage.saveChapterSpec(this.state.bookId, chNum, spec);

        // 展示Spec让用户确认
        document.getElementById('guideContent').innerHTML = `
            <div class="guide-card">
                <h3>📝 第${chNum}章 规划</h3>
                <div class="guide-spec">${this._formatSpec(spec)}</div>
                <p class="guide-hint">👆 这是AI为本章做的规划。你可以修改或补充。</p>
            </div>`;

        document.getElementById('guideActions').innerHTML = `
            <textarea class="guide-input" id="guideUserInput" placeholder="修改规划，比如：增加一个打斗场景、让男二出场..." rows="3"></textarea>
            <div class="guide-action-row">
                <button class="btn btn-outline" onclick="Guide._regenerateSpec()">🔄 重新规划</button>
                <button class="btn btn-primary" onclick="Guide._confirmSpecAndWrite()">确认规划，开始写正文 →</button>
            </div>`;
    },

    _formatSpec(spec) {
        // 简单格式化Spec为可读文本
        return spec
            .replace(/```yaml|```/g, '')
            .replace(/(\w+):/g, '<strong>$1:</strong>')
            .replace(/\n/g, '<br>')
            .replace(/^- /g, '• ');
    },

    async _regenerateSpec() {
        const inputEl = document.getElementById('guideUserInput');
        const feedback = inputEl ? inputEl.value.trim() : '';
        if (feedback) this.state.history.push({ role: 'user', content: '修改要求：' + feedback });
        await this._generateChapter(feedback || this.state.history[0]?.content || '');
    },

    async _confirmSpecAndWrite() {
        const inputEl = document.getElementById('guideUserInput');
        const feedback = inputEl ? inputEl.value.trim() : '';
        if (feedback) this.state.history.push({ role: 'user', content: '补充：' + feedback });

        document.getElementById('guideContent').innerHTML = `
            <div class="guide-card"><div class="guide-thinking">
                <div class="loading-spinner"><div class="spinner"></div></div>
                <p>AI正在基于规划写正文...</p>
            </div></div>`;
        document.getElementById('guideActions').innerHTML = '';

        const chNum = this.state.context.chapterCount + 1;
        const spec = this.state.generatedContent;
        const extraPrompt = this.state.history.filter(h => h.role === 'user').map(h => h.content).join('\n');
        const content = await AIService.generateChapterContent(this.state.bookId, chNum, spec, extraPrompt);

        // 保存
        const title = this._extractTitle(content) || `第${chNum}章`;
        Storage.addChapter(this.state.bookId, { title, content, status: 'draft' });
        Storage.updateBook(this.state.bookId, { chapterCount: Storage.getChapters(this.state.bookId).length });

        // 展示结果
        this._showGeneratedResult('章节', `## ${title}\n\n${content.substring(0, 500)}...\n\n*(已自动保存，可在书架中阅读)*`, 'chapter');
    },

    // ============ 评审引导 ============
    async _runReview(userInput) {
        const chs = Storage.getChapters(this.state.bookId);
        const last = chs[chs.length - 1];
        if (!last?.content) {
            document.getElementById('guideContent').innerHTML = `
                <div class="guide-card guide-error"><p>❌ 没有可评审的章节</p></div>`;
            document.getElementById('guideActions').innerHTML = `
                <button class="btn btn-outline btn-full" onclick="Guide._goBack()">返回</button>`;
            return;
        }

        document.getElementById('guideContent').innerHTML = `
            <div class="guide-card"><div class="guide-thinking">
                <div class="loading-spinner"><div class="spinner"></div></div>
                <p>AI正在从五个维度评审《${last.title}》...</p>
            </div></div>`;
        document.getElementById('guideActions').innerHTML = '';

        const review = await AIService.reviewChapter(this.state.bookId, last.content, last.title);
        Storage.saveChapterReview(this.state.bookId, last.order, review);

        // 展示评审结果，让用户选择要改哪些
        document.getElementById('guideContent').innerHTML = `
            <div class="guide-card">
                <h3>📊 评审报告：《${last.title}》</h3>
                <div class="guide-review">${this._formatReview(review)}</div>
            </div>
            <div class="guide-card guide-question">
                <p><strong>发现的问题你想怎么处理？</strong></p>
            </div>`;

        document.getElementById('guideActions').innerHTML = `
            <div class="guide-choices">
                <button class="guide-choice-btn" onclick="Guide._fixP0Only()">🚫 只修复P0红线问题</button>
                <button class="guide-choice-btn" onclick="Guide._fixAll()">🔧 修复所有问题</button>
                <button class="guide-choice-btn" onclick="Guide._skipFix()">✓ 已知悉，暂不修改</button>
            </div>
            <textarea class="guide-input" id="guideUserInput" placeholder="或者告诉AI具体怎么改..." rows="2"></textarea>
            <button class="btn btn-primary btn-full" onclick="Guide._applyFix()">执行修改 →</button>`;
    },

    _formatReview(review) {
        return review
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/✓/g, '<span class="guide-pass">✓</span>')
            .replace(/❌/g, '<span class="guide-fail">❌</span>');
    },

    async _fixP0Only() { await this._doFix('只修复P0红线问题（AI套话、感悟式结尾、上帝视角等）'); },
    async _fixAll() { await this._doFix('修复评审中提到的所有问题'); },
    async _skipFix() {
        showToast('评审完成，问题已记录');
        this._goBack();
    },

    async _applyFix() {
        const inputEl = document.getElementById('guideUserInput');
        const instruction = inputEl ? inputEl.value.trim() : '修复所有问题';
        await this._doFix(instruction);
    },

    async _doFix(instruction) {
        const chs = Storage.getChapters(this.state.bookId);
        const last = chs[chs.length - 1];
        if (!last) return;

        document.getElementById('guideContent').innerHTML = `
            <div class="guide-card"><div class="guide-thinking">
                <div class="loading-spinner"><div class="spinner"></div></div>
                <p>AI正在修改...</p>
            </div></div>`;
        document.getElementById('guideActions').innerHTML = '';

        const revised = await AIService.reviseContent(this.state.bookId, last.content, instruction);
        Storage.updateChapter(this.state.bookId, last.id, { content: revised });

        document.getElementById('guideContent').innerHTML = `
            <div class="guide-card guide-success">
                <h3>✅ 修改完成</h3>
                <p>修改已保存到《${last.title}》</p>
            </div>`;
        document.getElementById('guideActions').innerHTML = `
            <button class="btn btn-primary btn-full" onclick="Guide._goBack()">返回阅读 →</button>`;
    },

    // ============ 展示生成结果 ============
    _showGeneratedResult(label, content, type) {
        this.state.generatedContent = content;

        document.getElementById('guideContent').innerHTML = `
            <div class="guide-card">
                <h3>✅ ${label}生成完成</h3>
                <div class="guide-result">${this._formatReview(content)}</div>
            </div>
            <div class="guide-card guide-question">
                <p><strong>对这个结果满意吗？</strong></p>
            </div>`;

        const saveLabel = type === 'setting' ? '保存设定' : (type === 'outline' ? '保存大纲' : '满意，完成');
        document.getElementById('guideActions').innerHTML = `
            <div class="guide-choices">
                <button class="guide-choice-btn" onclick="Guide._saveAndFinish('${type}')">${saveLabel}</button>
                <button class="guide-choice-btn" onclick="Guide._requestRevise()">🔄 需要修改</button>
                <button class="guide-choice-btn" onclick="Guide._continueNext('${type}')">➡️ 继续下一步</button>
            </div>
            <textarea class="guide-input" id="guideUserInput" placeholder="告诉AI怎么改..." rows="2" style="display:none"></textarea>
            <button class="btn btn-primary btn-full" id="guideReviseBtn" onclick="Guide._doRevise()" style="display:none">确认修改</button>`;
    },

    _saveAndFinish(type) {
        if (type === 'setting') Storage.savePlan(this.state.bookId, 'setting', this.state.generatedContent);
        else if (type === 'outline') Storage.savePlan(this.state.bookId, 'outline', this.state.generatedContent);
        showToast(type === 'outline' ? '大纲·蓝图已保存' : '已保存');
        this._goBack();
    },

    _requestRevise() {
        document.querySelectorAll('.guide-choices').forEach(el => el.style.display = 'none');
        document.getElementById('guideUserInput').style.display = '';
        document.getElementById('guideReviseBtn').style.display = '';
    },

    async _doRevise() {
        const inputEl = document.getElementById('guideUserInput');
        const feedback = inputEl?.value.trim() || '请改进';
        document.getElementById('guideContent').innerHTML = `
            <div class="guide-card"><div class="guide-thinking">
                <div class="loading-spinner"><div class="spinner"></div></div>
                <p>AI正在根据你的反馈修改...</p>
            </div></div>`;
        document.getElementById('guideActions').innerHTML = '';

        const revised = await AIService.reviseContent(this.state.bookId, this.state.generatedContent, feedback);
        this._showGeneratedResult(this.state.mode === 'setting' ? '设定' : (this.state.mode === 'outline' ? '大纲' : '章节'), revised, this.state.mode);
    },

    _continueNext(type) {
        this._saveAndFinish(type);
        if (type === 'setting') this.start(this.state.bookId, 'outline');
        else if (type === 'outline') this.start(this.state.bookId, 'chapter');
        else this._goBack();
    },

    // ============ 辅助 ============
    _extractTitle(content) {
        if (!content) return null;
        const firstLine = content.split('\n')[0]?.replace(/【.*?】/g, '').trim();
        if (firstLine && firstLine.length > 3 && firstLine.length < 30) return firstLine;
        return null;
    },

    _goBack() {
        if (currentBookId) showBookDetail(currentBookId);
        else switchTab('bookshelf');
    },

    _retry() {
        this.state.step = 0;
        this._render();
    }
};
