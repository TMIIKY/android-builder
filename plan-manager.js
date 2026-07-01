/**
 * 创作规划管理器
 * 两Tab：世界观设定 | 故事大纲·蓝图
 * 支持 AI 交互式引导生成 + 手动编辑
 * 
 * 交互流程：用户点"AI 生成" → 弹出引导问题 → 用户回答 → AI 基于回答生成
 */

const PlanManager = {
    state: {
        bookId: null,
        tab: 'setting', // setting | outline
        generating: false,
        guideStep: 0,   // 引导问题当前步骤
        guideAnswers: {}, // 用户对引导问题的回答
        mode: 'normal', // normal | guide | desc_generate | revise
        descInput: '',  // 描述生成时用户的自由描述内容
    },

    // ============ 引导问题配置 ============
    GUIDE_QUESTIONS: {
        setting: [
            { key: 'era', label: '故事发生在什么时代？', hint: '如：古代架空、近未来科幻、现代都市、末日废土…', type: 'text' },
            { key: 'world_scale', label: '世界的规模有多大？', hint: '如：一座城市、一个大陆、多个位面、银河系…', type: 'text' },
            { key: 'power_system', label: '有没有特殊力量体系？', hint: '如：修仙灵气、魔法元素、科技异能、无特殊力量…', type: 'text' },
            { key: 'social', label: '社会结构是什么样的？', hint: '如：帝国皇权、宗门林立、民主联邦、部落氏族…', type: 'text' },
            { key: 'tone', label: '故事的整体氛围基调？', hint: '如：热血激昂、悬疑诡谲、轻松搞笑、黑暗压抑…', type: 'text' }
        ],
        outline: [
            { key: 'core_conflict', label: '故事的核心冲突是什么？', hint: '如：复仇雪恨、查明真相、生存危机、权力争夺、守护珍视之人…', type: 'text' },
            { key: 'protagonist_goal', label: '主角最终想要达成什么？', hint: '如：成为最强、找到亲人、推翻暴政、拯救世界…', type: 'text' },
            { key: 'antagonist', label: '主要对手/反派是谁？', hint: '如：某个组织、一个宿敌、内心的黑暗、命运的诅咒…', type: 'text' },
            { key: 'total_chapters', label: '计划写多少章？', hint: '如：30、100、200、500…（这决定了大纲和蓝图规划的规模）', type: 'text' },
            { key: 'chapter_length', label: '每章大概多少字？', hint: '如：2000字短文、3000-5000字标准、8000字长章…（这决定了每章内容的深度）', type: 'text' },
            { key: 'pace', label: '节奏偏好？', hint: '如：快节奏每章都有爆点、慢热型逐步展开、张弛交替…', type: 'text' },
            { key: 'ending', label: '你想要的结局走向？', hint: '如：圆满结局、悲剧收场、开放式结局、反转结局…', type: 'text' }
        ],
    },

    /**
     * 打开创作规划页
     */
    open(bookId) {
        if (!bookId) { showToast('请先选择作品'); return; }
        this.state.bookId = bookId;
        this.state.tab = 'setting';
        this.state.guideStep = 0;
        this.state.guideAnswers = {};
        this._render();
        openSheet('planSheet');
    },

    switchTab(tab) {
        this.state.tab = tab;
        this.state.guideStep = 0;
        this.state.guideAnswers = {};
        this._renderTabs();
        this._renderContent();
    },

    _render() {
        this._renderTabs();
        this._renderContent();
    },

    _renderTabs() {
        const tabs = document.getElementById('planTabs');
        if (!tabs) return;
        const items = [
            { key: 'setting', label: '世界观设定' },
            { key: 'outline', label: '故事大纲·蓝图' }
        ];
        tabs.innerHTML = items.map(t => `
            <button class="plan-tab ${this.state.tab === t.key ? 'active' : ''}"
                    onclick="PlanManager.switchTab('${t.key}')">${t.label}</button>
        `).join('');
    },

    _renderContent() {
        const container = document.getElementById('planContent');
        if (!container) return;

        const plans = Storage.getPlans(this.state.bookId);
        const content = plans[this.state.tab] || '';

        // 如果正在引导问答，显示引导界面
        if (this.state.mode === 'guide' && this.state.guideStep > 0) {
            this._renderGuide(container);
            return;
        }

        // 如果正在描述生成，显示描述输入界面
        if (this.state.mode === 'desc_generate') {
            this._renderDescGenerate(container);
            return;
        }

        // 如果正在提建议修改，显示建议输入界面
        if (this.state.mode === 'revise') {
            this._renderRevise(container);
            return;
        }

        const tabLabels = { setting: '世界观设定', outline: '故事大纲·蓝图' };

        if (content) {
            // 有内容：显示文本框 + 操作按钮
            const isOutline = this.state.tab === 'outline';
            
            // 从大纲内容中解析总章数和规划信息
            let totalChapters = 0;
            let lastPlannedChapter = 0;
            let perChapterWords = '';
            if (isOutline && content) {
                const tcMatch = content.match(/总章数[：:]\s*(\d+)/) || content.match(/(\d+)\s*章[的之]?规模/);
                if (tcMatch) totalChapters = parseInt(tcMatch[1]);
                const wcMatch = content.match(/每章字数[：:]\s*(\d+[-~]\d+|\d+)\s*字/);
                if (wcMatch) perChapterWords = wcMatch[1];
                // 统计大纲中已规划到第几章
                lastPlannedChapter = this._getLastPlannedChapter(content, Storage.getChapters(this.state.bookId));
            }
            
            const remaining = totalChapters > 0 ? Math.max(0, totalChapters - lastPlannedChapter) : 0;
            const allPlanned = totalChapters > 0 && lastPlannedChapter >= totalChapters;
            
            // 状态提示
            let statusHtml = '';
            if (isOutline) {
                let statusParts = [];
                if (totalChapters > 0) statusParts.push(`目标 ${totalChapters} 章`);
                if (perChapterWords) statusParts.push(`每章 ${perChapterWords} 字`);
                if (lastPlannedChapter > 0) statusParts.push(`已规划到第 ${lastPlannedChapter} 章`);
                if (allPlanned) {
                    statusParts.push('✅ 全部规划完毕');
                } else if (totalChapters > 0) {
                    statusParts.push(`剩余 ${remaining} 章`);
                }
                statusHtml = `<p class="plan-saved-hint"${allPlanned ? ' style="color:#22c55e"' : ''}>${statusParts.join(' · ')} · ${this._countChars(content)} 字</p>`;
            } else {
                statusHtml = `<p class="plan-saved-hint">已保存 · ${this._countChars(content)} 字</p>`;
            }
            
            container.innerHTML = `
                <div class="plan-editor">
                    <textarea class="plan-textarea" id="planTextarea">${escapeHtml(content)}</textarea>
                    <div class="plan-actions">
                        <button class="btn btn-outline btn-sm" onclick="PlanManager._save()">💾 保存</button>
                        <button class="btn btn-accent btn-sm" id="planAiBtn"
                            onclick="PlanManager._startGuide()"
                            ${this.state.generating ? 'disabled' : ''}>
                            ${this.state.generating ? '⏳ 生成中…' : '✨ AI 引导生成'}
                        </button>
                        <button class="btn btn-accent btn-sm" id="planDescBtn"
                            onclick="PlanManager._startDescGenerate()"
                            ${this.state.generating ? 'disabled' : ''}>
                            📝 根据描述生成
                        </button>
                        <button class="btn btn-outline btn-sm" onclick="PlanManager._startRevise()">🔧 提建议修改</button>
                    </div>${statusHtml}
                </div>
            `;
        } else {
            // 无内容：显示空状态引导
            container.innerHTML = `
                <div class="plan-editor">
                    <div class="plan-empty-state">
                        <div class="plan-empty-icon">${this._getGuideEmoji(this.state.tab)}</div>
                        <h4>还没有「${tabLabels[this.state.tab]}」</h4>
                        <p class="plan-empty-hint">选择一种方式开始创建</p>
                        <div class="plan-empty-actions">
                            <button class="btn btn-accent" onclick="PlanManager._startGuide()">
                                ✨ AI 引导生成<br><small>回答几个问题，AI 帮你写</small>
                            </button>
                            <button class="btn btn-accent" onclick="PlanManager._startDescGenerate()">
                                📝 根据描述生成<br><small>直接描述你的想法，AI 帮你展开</small>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }
    },

    _renderDraftGenerateUI() {
        // 已移除章节细纲功能，保留空方法防止外部调用报错
    },

    _buildDraftSelectorHtml() {
        // 已移除章节细纲功能，保留空方法防止外部调用报错
        return '';
    },

    async _draftGenerateFromSelect() {
        // 已移除章节细纲功能，保留空方法防止外部调用报错
    },

    // ============ 描述生成 ============

    /** 开始描述生成：显示描述输入框 */
    _startDescGenerate() {
        this.state.mode = 'desc_generate';
        this._renderContent();
    },

    /** 渲染描述生成界面 */
    _renderDescGenerate(container) {
        const tabLabels = { setting: '世界观设定', outline: '故事大纲·蓝图' };
        const descHints = {
            setting: '比如：这是一个修仙世界，有五大宗门统治大陆，灵气分九阶，每千年有一次天劫…',
            outline: '比如：主角原本是废柴，意外获得上古传承后崛起，一路打脸反派，最终成为最强，但发现自己只是某个大能的棋子…\n\n提示：可以在描述中写明总章数和每章字数，比如"计划写100章，每章3000-5000字"，AI会据此自动规划阶段和章节蓝图。'
        };

        container.innerHTML = `
            <div class="plan-editor">
                <div class="plan-guide">
                    <div class="plan-guide-question">
                        <div class="plan-guide-step">📝</div>
                        <h4>描述你想要的「${tabLabels[this.state.tab]}」</h4>
                        <p class="plan-guide-hint">用你自己的话描述，越详细 AI 生成越精准</p>
                    </div>
                    <div class="plan-guide-input-area">
                        <textarea class="plan-textarea" id="descInput" rows="6"
                            placeholder="${descHints[this.state.tab]}"
                            style="min-height:150px">${escapeHtml(this.state.descInput)}</textarea>
                    </div>
                    <div class="plan-guide-actions">
                        <button class="btn btn-outline btn-sm" onclick="PlanManager._cancelDescGenerate()">取消</button>
                        <button class="btn btn-accent btn-sm" onclick="PlanManager._doDescGenerate()">✨ 生成</button>
                    </div>
                </div>
            </div>
        `;

        // 自动聚焦
        setTimeout(() => {
            const input = document.getElementById('descInput');
            if (input) input.focus();
        }, 100);
    },

    /** 取消描述生成 */
    _cancelDescGenerate() {
        this.state.mode = 'normal';
        this.state.descInput = '';
        this._renderContent();
    },

    /** 执行描述生成 */
    async _doDescGenerate() {
        const descInput = document.getElementById('descInput');
        const userDesc = descInput ? descInput.value.trim() : '';
        if (!userDesc) { showToast('请先描述你想要的内容'); return; }

        this.state.descInput = userDesc;
        this.state.mode = 'normal';
        if (this.state.generating) return;
        this.state.generating = true;
        this._renderThinking('desc');

        const book = Storage.getBook(this.state.bookId);
        const plans = Storage.getPlans(this.state.bookId);
        const chapters = Storage.getChapters(this.state.bookId);

        try {
            const { systemPrompt, userPrompt } = this._buildDescPrompts(book, plans, chapters, userDesc);
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ];
            // 自适应 maxTokens：描述生成根据总章数调整
            let maxTokens = 4096;
            if (this.state.tab === 'outline') {
                const totalCh = this._parseTotalChapters(userDesc);
                maxTokens = this._calcAdaptiveMaxTokens(totalCh);
            }
            const aiResult = await AIService.callAPI(messages, { temperature: 0.7, maxTokens });

            if (aiResult) {
                this.state.generating = false;
                
                this._renderContent();
                const textarea = document.getElementById('planTextarea');
                if (textarea) {
                    textarea.value = aiResult;
                    textarea.scrollTop = textarea.scrollHeight;
                }
                Storage.savePlan(this.state.bookId, this.state.tab, aiResult);
                showToast('✨ AI 已生成，请审阅修改后保存');
            } else {
                showToast('AI 返回为空，请重试');
                this.state.generating = false;
                this._renderContent();
            }
        } catch (e) {
            showToast('生成失败：' + (e.message || '网络错误'));
            this.state.generating = false;
            this._renderContent();
        }
    },

    // ============ 提建议修改 ============

    /** 开始提建议修改 */
    _startRevise() {
        const plans = Storage.getPlans(this.state.bookId);
        const content = plans[this.state.tab] || '';
        if (!content) { showToast('当前没有内容可以修改'); return; }
        this.state.mode = 'revise';
        this._renderContent();
    },

    /** 渲染提建议修改界面 */
    _renderRevise(container) {
        const tabLabels = { setting: '世界观设定', outline: '故事大纲·蓝图' };
        const plans = Storage.getPlans(this.state.bookId);
        const currentContent = plans[this.state.tab] || '';

        container.innerHTML = `
            <div class="plan-editor">
                <div class="plan-guide">
                    <div class="plan-guide-question">
                        <div class="plan-guide-step">🔧</div>
                        <h4>告诉 AI 哪里需要改</h4>
                        <p class="plan-guide-hint">描述你对当前「${tabLabels[this.state.tab] || '内容'}」的不满意之处，AI 会针对性修改</p>
                    </div>
                    <div class="plan-guide-input-area">
                        <textarea class="plan-textarea" id="reviseInput" rows="5"
                            placeholder="比如：力量体系太简单了，希望增加更多层级和代价；反派动机不够强，需要更合理的背景故事…"
                            style="min-height:120px"></textarea>
                    </div>
                    <div class="plan-revise-preview">
                        <div class="plan-revise-preview-header">
                            <span>📄 当前内容（${this._countChars(currentContent)} 字）</span>
                            <span class="plan-revise-preview-toggle" onclick="PlanManager._toggleRevisePreview()">展开 ▾</span>
                        </div>
                        <div class="plan-revise-preview-content" id="revisePreviewContent" style="display:none">
                            <pre>${escapeHtml(currentContent)}</pre>
                        </div>
                    </div>
                    <div class="plan-guide-actions">
                        <button class="btn btn-outline btn-sm" onclick="PlanManager._cancelRevise()">取消</button>
                        <button class="btn btn-accent btn-sm" onclick="PlanManager._doRevise()">🔧 提交修改</button>
                    </div>
                </div>
            </div>
        `;
    },

    /** 展开/折叠当前内容预览 */
    _toggleRevisePreview() {
        const content = document.getElementById('revisePreviewContent');
        const toggle = document.querySelector('.plan-revise-preview-toggle');
        if (!content || !toggle) return;
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? 'block' : 'none';
        toggle.textContent = isHidden ? '收起 ▴' : '展开 ▾';
    },

    /** 取消提建议修改 */
    _cancelRevise() {
        this.state.mode = 'normal';
        this._renderContent();
    },

    /** 执行提建议修改 */
    async _doRevise() {
        const reviseInput = document.getElementById('reviseInput');
        const feedback = reviseInput ? reviseInput.value.trim() : '';
        if (!feedback) { showToast('请描述你想要修改的地方'); return; }

        this.state.mode = 'normal';
        if (this.state.generating) return;
        this.state.generating = true;
        this._renderThinking('revise');

        const book = Storage.getBook(this.state.bookId);
        const plans = Storage.getPlans(this.state.bookId);
        const currentContent = plans[this.state.tab] || '';
        const tabLabels = { setting: '世界观设定', outline: '故事大纲·蓝图' };

        try {
            const systemPrompt = `你是一位专业小说创作顾问。用户对已生成的「${tabLabels[this.state.tab] || '内容'}」不满意，请你根据用户的反馈意见进行修改。

## 修改原则
- 只修改用户指出的问题，不要改动其他用户没有意见的部分
- 保持原有的整体结构和风格
- 修改后输出完整内容（不是只输出修改的部分）
- 用中文回答`;

            const userPrompt = `## 作品信息
小说《${book?.name || ''}》，类型：${book?.genre || '未分类'}

## 当前内容（请在此基础上修改）
${currentContent}

## 用户修改意见
${feedback}

## 要求
请根据上述修改意见，输出修改后的完整内容。直接输出内容，不需要额外解释。`;

            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ];
            const aiResult = await AIService.callAPI(messages, { temperature: 0.6, maxTokens: 4096 });

            if (aiResult) {
                this.state.generating = false;
                this._renderContent();
                const textarea = document.getElementById('planTextarea');
                if (textarea) {
                    textarea.value = aiResult;
                    textarea.scrollTop = textarea.scrollHeight;
                }
                Storage.savePlan(this.state.bookId, this.state.tab, aiResult);
                showToast('🔧 已根据建议修改，请审阅');
            } else {
                showToast('AI 返回为空，请重试');
                this.state.generating = false;
                this._renderContent();
            }
        } catch (e) {
            showToast('修改失败：' + (e.message || '网络错误'));
            this.state.generating = false;
            this._renderContent();
        }
    },

    // ============ 交互式引导 ============

    /** 开始引导问答 */
    _startGuide() {
        this.state.guideStep = 1;
        this.state.guideAnswers = {};
        this.state.mode = 'guide';
        this._renderContent();
    },

    /** 渲染引导问答界面 */
    _renderGuide(container) {
        const questions = this.GUIDE_QUESTIONS[this.state.tab] || [];
        const totalSteps = questions.length + 1; // +1 为确认步骤
        const currentQ = questions[this.state.guideStep - 1];

        if (!currentQ) {
            // 所有问题回答完毕，显示确认页
            this._renderGuideConfirm(container, questions);
            return;
        }

        container.innerHTML = `
            <div class="plan-editor">
                <div class="plan-guide">
                    <div class="plan-guide-progress">
                        <span>问题 ${this.state.guideStep}/${totalSteps - 1}</span>
                        <div class="plan-guide-bar">
                            <div class="plan-guide-bar-fill" style="width:${(this.state.guideStep / totalSteps) * 100}%"></div>
                        </div>
                    </div>
                    <div class="plan-guide-question">
                        <div class="plan-guide-step">${this._getGuideEmoji(this.state.tab)}</div>
                        <h4>${currentQ.label}</h4>
                        <p class="plan-guide-hint">${currentQ.hint}</p>
                    </div>
                    <div class="plan-guide-input-area">
                        <input type="text" class="plan-guide-input" id="guideInput"
                            placeholder="${currentQ.hint}"
                            value="${escapeHtml(this.state.guideAnswers[currentQ.key] || '')}"
                            onkeydown="if(event.key==='Enter')PlanManager._nextGuideStep()">
                        <div class="plan-guide-quick-chips" id="guideChips"></div>
                    </div>
                    <div class="plan-guide-actions">
                        ${this.state.guideStep > 1 ? '<button class="btn btn-outline btn-sm" onclick="PlanManager._prevGuideStep()">← 上一题</button>' : '<span></span>'}
                        <button class="btn btn-accent btn-sm" onclick="PlanManager._nextGuideStep()">下一题 →</button>
                    </div>
                </div>
            </div>
        `;

        // 添加快捷选项
        setTimeout(() => this._renderQuickChips(currentQ), 50);
    },

    /** 渲染确认页 */
    _renderGuideConfirm(container, questions) {
        const tabLabels = { setting: '世界观设定', outline: '故事大纲·蓝图' };
        const answersHtml = questions.map(q => `
            <div class="plan-confirm-item">
                <span class="plan-confirm-q">${q.label}</span>
                <span class="plan-confirm-a">${this.state.guideAnswers[q.key] || '（未填）'}</span>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="plan-editor">
                <div class="plan-guide">
                    <div class="plan-guide-progress">
                        <span>✓ 引导完成</span>
                        <div class="plan-guide-bar">
                            <div class="plan-guide-bar-fill" style="width:100%"></div>
                        </div>
                    </div>
                    <div class="plan-guide-question">
                        <h4>确认生成「${tabLabels[this.state.tab]}」</h4>
                        <p class="plan-guide-hint">AI 将基于以下信息为你生成内容，确认无误后点击生成</p>
                    </div>
                    <div class="plan-confirm-list">${answersHtml}</div>
                    <div class="plan-guide-actions">
                        <button class="btn btn-outline btn-sm" onclick="PlanManager._prevGuideStep()">← 返回修改</button>
                        <button class="btn btn-accent btn-sm" onclick="PlanManager._doGenerate()">✨ 开始生成</button>
                    </div>
                </div>
            </div>
        `;
    },

    /** 快捷选项 */
    _renderQuickChips(question) {
        const chipsEl = document.getElementById('guideChips');
        if (!chipsEl) return;

        const chipsMap = {
            era: ['古代架空', '近未来科幻', '现代都市', '末日废土', '异世界'],
            world_scale: ['一座城市', '一个大陆', '多个位面', '银河系'],
            power_system: ['修仙灵气', '魔法元素', '科技异能', '无特殊力量', '系统流'],
            social: ['帝国皇权', '宗门林立', '民主联邦', '部落氏族', '末世幸存者'],
            tone: ['热血激昂', '悬疑诡谲', '轻松搞笑', '黑暗压抑', '治愈温暖'],
            core_conflict: ['复仇雪恨', '查明真相', '生存危机', '权力争夺', '守护珍视之人', '自我突破'],
            protagonist_goal: ['成为最强', '找到真相', '推翻暴政', '拯救世界', '守护家人'],
            antagonist: ['某个神秘组织', '一个宿敌', '内心的黑暗', '命运的诅咒', '整个体制'],
            total_chapters: ['30章', '50章', '100章', '200章', '500章'],
            chapter_length: ['2000字', '3000-5000字', '5000-8000字'],
            pace: ['快节奏每章爆点', '慢热逐步展开', '张弛交替'],
            ending: ['圆满结局', '悲剧收场', '开放式结局', '反转结局', '意犹未尽']
        };

        const chips = chipsMap[question.key] || [];
        if (chips.length === 0) {
            chipsEl.style.display = 'none';
            return;
        }

        chipsEl.style.display = '';
        chipsEl.innerHTML = chips.map(c =>
            `<span class="guide-chip" onclick="PlanManager._selectChip('${question.key}', '${c}')">${c}</span>`
        ).join('');
    },

    /** 选择快捷选项 */
    _selectChip(key, value) {
        this.state.guideAnswers[key] = value;
        const input = document.getElementById('guideInput');
        if (input) input.value = value;
    },

    /** 下一步引导问题 */
    _nextGuideStep() {
        const questions = this.GUIDE_QUESTIONS[this.state.tab] || [];
        const currentQ = questions[this.state.guideStep - 1];

        // 保存当前答案
        if (currentQ) {
            const input = document.getElementById('guideInput');
            if (input && input.value.trim()) {
                this.state.guideAnswers[currentQ.key] = input.value.trim();
            }
        }

        if (this.state.guideStep <= questions.length) {
            this.state.guideStep++;
            this._renderContent();
        }
    },

    /** 上一步引导问题 */
    _prevGuideStep() {
        if (this.state.guideStep > 1) {
            this.state.guideStep--;
            this._renderContent();
        }
    },

    _getGuideEmoji(tab) {
        return { setting: '🌍', outline: '📋' }[tab] || '📝';
    },

    // ============ AI 生成 ============

    /** 执行 AI 生成 */
    async _doGenerate() {
        if (this.state.generating) return;
        this.state.generating = true;

        const book = Storage.getBook(this.state.bookId);
        const plans = Storage.getPlans(this.state.bookId);
        const chapters = Storage.getChapters(this.state.bookId);
        const answers = this.state.guideAnswers;

        try {
            this._renderThinking();
            const { systemPrompt, userPrompt } = this._buildPrompts(book, plans, chapters, answers);
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ];

            let maxTokens = 4096;
            if (this.state.tab === 'outline') {
                const totalCh = parseInt(answers.total_chapters) || 0;
                maxTokens = this._calcAdaptiveMaxTokens(totalCh);
            }
            const aiResult = await AIService.callAPI(messages, { temperature: 0.7, maxTokens });

            if (aiResult) {
                this.state.guideStep = 0;
                this.state.guideAnswers = {};
                this.state.mode = 'normal';
                this.state.generating = false;

                this._renderContent();
                const textarea = document.getElementById('planTextarea');
                if (textarea) {
                    textarea.value = aiResult;
                    textarea.scrollTop = textarea.scrollHeight;
                }
                Storage.savePlan(this.state.bookId, this.state.tab, aiResult);
                showToast('✨ AI 已生成，请审阅修改后保存');
            } else {
                showToast('AI 返回为空，请重试');
                this.state.generating = false;
                this._renderContent();
            }
        } catch (e) {
            showToast('生成失败：' + (e.message || '网络错误'));
            this.state.generating = false;
            this._renderContent();
        }
    },

    /** 显示思考状态 */
    _renderThinking(source) {
        const container = document.getElementById('planContent');
        if (!container) return;

        const tabLabels = { setting: '世界观设定', outline: '故事大纲·蓝图' };
        const thinkingStages = {
            setting: ['分析时代背景…', '构建社会结构…', '设计力量体系…', '梳理势力关系…', '生成世界观设定…'],
            outline: ['分析核心冲突…', '计算最佳阶段划分…', '设计人物弧光与爆点分布…', '规划每阶段章节范围与关键事件…', '生成故事大纲·蓝图…']
        };
        const reviseStages = ['分析当前内容…', '理解修改意见…', '定位问题段落…', '重构相关内容…', '输出修改结果…'];

        const stages = source === 'revise' ? reviseStages : (thinkingStages[this.state.tab] || ['分析中…', '思考中…', '生成中…']);
        const title = source === 'revise' ? 'AI 正在修改「' + tabLabels[this.state.tab] + '」' : 'AI 正在为你生成「' + tabLabels[this.state.tab] + '」';
        const hint = source === 'revise' ? '基于你的建议，AI 正在完善中…' : (source === 'desc' ? '基于你的描述，AI 正在构思中…' : '基于你的回答，AI 正在构思中…');

        container.innerHTML = `
            <div class="plan-editor">
                <div class="plan-thinking">
                    <div class="plan-thinking-icon">${source === 'revise' ? '🔧' : '✨'}</div>
                    <h4>${title}</h4>
                    <p class="plan-thinking-hint">${hint}</p>
                    <div class="plan-thinking-stages" id="thinkingStages">
                        ${stages.map((s, i) => `
                            <div class="thinking-stage" id="thinkingStage${i}">
                                <span class="thinking-stage-dot"></span>
                                <span>${s}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        // 动画：逐条点亮思考阶段
        let stageIdx = 0;
        this._thinkingTimer = setInterval(() => {
            if (stageIdx < stages.length) {
                const el = document.getElementById('thinkingStage' + stageIdx);
                if (el) el.classList.add('active');
                stageIdx++;
            } else {
                clearInterval(this._thinkingTimer);
            }
        }, 800);
    },

    // ============ Prompt 构建 ============

    _buildPrompts(book, plans, chapters, answers) {
        const bookInfo = `小说《${book?.name || ''}》，类型：${book?.genre || '未分类'}，简介：${book?.desc || '无'}`;

        if (this.state.tab === 'setting') {
            return {
                systemPrompt: `你是一位资深世界观架构师，擅长为小说构建丰富而自洽的世界设定。请基于用户提供的信息，生成结构化的世界观设定文档。

## 输出要求
- 用中文回答，条理清晰
- 使用 Markdown 标题分节
- 内容要具体、有细节，不要空泛
- 每个部分至少写 3-5 句实质内容`,

                userPrompt: `## 作品信息
${bookInfo}
${plans.setting ? `\n## 已有设定（请在此基础上补充完善，不要重复已有内容）\n${plans.setting.substring(0, 300)}` : ''}

## 用户对世界观的构想
- **时代背景**：${answers.era || '未指定'}
- **世界规模**：${answers.world_scale || '未指定'}
- **力量体系**：${answers.power_system || '未指定'}
- **社会结构**：${answers.social || '未指定'}
- **氛围基调**：${answers.tone || '未指定'}

## 请按以下结构生成世界观设定：

### 一、时代与地理
（基于"${answers.era || '时代'}"展开，描述时间背景和地理环境）

### 二、社会与势力
（基于"${answers.social || '社会'}"展开，描述社会阶层、势力分布、权力关系）

### 三、力量体系
（基于"${answers.power_system || '力量'}"展开，详细描述力量等级、获取方式、限制规则）

### 四、核心规则
（这个世界的特殊法则：什么能做、什么不能做、代价是什么）

### 五、伏笔与冲突种子
（从世界观中自然产生的潜在冲突和伏笔）

请直接输出内容，不需要额外解释。`
            };
        }

        if (this.state.tab === 'outline') {
            // 解析总章数、每章字数
            const totalChapters = parseInt(answers.total_chapters) || 0;
            const chapterLength = answers.chapter_length || '未指定';
            const pace = answers.pace || '张弛交替';
            
            // 自动推算阶段数
            const autoStages = totalChapters > 0 ? this._calcAutoStageCount(totalChapters) : 4;
            const stageRanges = totalChapters > 0 ? this._calcStageChapterRanges(totalChapters, autoStages) : '';
            const eventsPerStage = totalChapters <= 0 ? '3-5' : (totalChapters <= 50 ? '3-5' : (totalChapters <= 200 ? '5-8' : '8-12'));
            const detailPerStage = totalChapters <= 0 ? '简洁' : (totalChapters <= 50 ? '简洁' : (totalChapters <= 200 ? '中等详细' : '高度详细'));
            
            // 每章字数对应的内容深度指导
            let chapterDepthHint = '';
            if (chapterLength && chapterLength !== '未指定') {
                const wcNum = parseInt(chapterLength.match(/\d+/)?.[0] || '0');
                if (wcNum <= 2000) chapterDepthHint = '每章内容精炼，核心事件控制在1-2个';
                else if (wcNum <= 5000) chapterDepthHint = '每章可容纳2-3个场景，细节描写适中';
                else chapterDepthHint = '每章可容纳3-5个场景，充分展开细节和内心戏';
            }
            
            // 构建蓝图式的阶段要求
            let stageRequirement = '';
            if (totalChapters > 0) {
                const burstPositions = this._calcBurstPositions(totalChapters, autoStages);
                stageRequirement = `\n## 📐 章节蓝图规格（请严格按此框架生成）\n
总章数：${totalChapters} 章
每章字数：${chapterLength}
${chapterDepthHint ? `内容深度：${chapterDepthHint}` : ''}
节奏偏好：${pace}

自动推算：分为 ${autoStages} 个阶段
建议章节范围分配：${stageRanges}

## 阶段划分要求
请按 ${autoStages} 个阶段展开，每个阶段必须明确标注章节范围（如"第1-XX章"），每阶段 ${eventsPerStage} 个关键事件，描述应**${detailPerStage}**。

## 高潮与爆点分布
- **小爆点**：每 3-8 章出现一次（维持读者兴趣）
- **中爆点**：阶段交界处（推动转折）
- **大高潮**：约第${Math.floor(totalChapters * 0.7)}-${Math.floor(totalChapters * 0.85)}章（全书情绪巅峰）
- **最终收束**：第${Math.floor(totalChapters * 0.85)}-${totalChapters}章（结局与余韵）

${burstPositions}`;
            } else {
                stageRequirement = `\n## 分阶段结构\n请按起承转合展开，每阶段 ${eventsPerStage} 个关键事件。`;
            }
            
            const settingCutLen = totalChapters <= 50 ? 500 : (totalChapters <= 200 ? 1000 : 2000);

            return {
                systemPrompt: `你是一位专业故事结构规划师与策划编辑，擅长为长篇小说设计引人入胜的叙事结构。请基于用户提供的信息，生成一份**融合创作蓝图的故事大纲**。

## 你的输出将作为：
1. 故事整体框架（主线剧情 + 人物弧光）
2. 章节创作蓝图（每阶段章节范围 + 爆点分布 + 节奏曲线）
3. 后续逐章写作的强制参考依据

## 输出要求
- 用中文回答，条理清晰
- 使用 Markdown 标题分节
- 每阶段要有具体的关键事件，不是空泛的描述
- **必须明确标注每个阶段的章节范围**（如"第一阶段：重逢与怀疑（第1-30章）"）
- 注意故事的因果关系和情绪起伏
- 标注关键爆点/高潮所在的章节位置`,

                userPrompt: `## 作品信息
${bookInfo}
${plans.setting ? `\n## 世界观设定\n${plans.setting.substring(0, settingCutLen)}` : ''}
${plans.outline ? `\n## 已有大纲（请在此基础上扩展细化，不要重复已有内容）\n${plans.outline.substring(0, 500)}` : ''}

## 用户对故事的构想
- **核心冲突**：${answers.core_conflict || '未指定'}
- **主角目标**：${answers.protagonist_goal || '未指定'}
- **主要对手**：${answers.antagonist || '未指定'}
- **总章数**：${totalChapters > 0 ? totalChapters + '章' : '未指定'}
- **每章字数**：${chapterLength}
- **节奏偏好**：${pace}
- **结局走向**：${answers.ending || '未指定'}
${stageRequirement}

## 请按以下结构生成故事大纲·蓝图：

### 一、一句话卖点
（用一句话概括整个故事的独特吸引力）

### 二、全书阶段蓝图
${totalChapters > 0 ? `将 ${totalChapters} 章分为 ${autoStages} 个阶段，参考分配：${stageRanges}` : '按起承转合展开'}

为每个阶段输出：
#### 第N阶段：阶段名称（第X-XX章）
- **章节范围**：第X-XX章（${totalChapters > 0 ? `共XX章` : ''}）
- **核心冲突**：这个阶段的主要矛盾是什么
- **情绪走向**：从___到___（如"从压抑到爆发"）
- **主角成长**：这个阶段主角的关键变化
- **关键事件**：
  1. （具体事件描述）
  2. ...
- **阶段结局**：这个阶段结束时的状态

### 三、爆点与高潮分布
标注全书的情绪张力曲线：
- **小爆点**：在哪些章节位置，什么类型的事件
- **中爆点**：在哪些阶段交界处，什么类型的事件
- **大高潮**：全书核心高潮在第几章，描述关键事件
- **最终收束**：结局章节的情绪处理和收尾方式

### 四、人物弧光
主角在每个阶段的成长变化轨迹（能力/心态/关系）

### 五、伏笔埋设与回收计划
列出 5-10 个关键伏笔，标注：埋设阶段 → 回收阶段 → 伏笔内容

### 六、章末钩子策略
每章结尾的钩子类型分布建议（悬念钩子/情绪钩子/事件钩子/反转钩子）

请直接输出内容，不需要额外解释。`
            };
        }

        // 如果 tab 不是 setting 也不是 outline，降级为 outline
        return this._buildPrompts(book, plans, chapters, { ...answers, ...{ total_chapters: '30' } });
    },

    // ============ 章节细纲功能已移除 ============
    // 原因：在逐章即时生成（Spec驱动）的架构下，提前生成的细纲无法感知前文实际状态，
    // 其"状态快照"与Spec的before_state高度重叠且可能不一致。
    // 大纲蓝图已提供方向性指导，Spec提供实时状态约束，两者之间无需冗余的细纲层。

    async _oneClickDraftGenerate() {
        // 已移除，保留空方法防止外部调用报错
    },

    async _doChapterDraftGenerateForRange() {
        // 已移除，保留空方法防止外部调用报错
    },

    async _doChapterDraftGenerate() {
        // 已移除，保留空方法防止外部调用报错
    },

    async _generateNextSegment() {
        // 已移除，保留空方法防止外部调用报错
    },

    _finishAllSegments() {
        // 已移除，保留空方法防止外部调用报错
    },

    _mergeSegmentResults() {
        // 已移除，保留空方法防止外部调用报错
        return '';
    },

    _renderSegmentProgress() {
        // 已移除，保留空方法防止外部调用报错
    },

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    _buildDraftPrompt() {
        // 已移除，保留空方法防止外部调用报错
        return { systemPrompt: '', userPrompt: '' };
    },

    _parseTotalChaptersFromOutline(outline) {
        if (!outline) return 0;
        const tcMatch = outline.match(/总章数[：:]\s*(\d+)/) || outline.match(/(\d+)\s*章[的之]?规模/);
        return tcMatch ? parseInt(tcMatch[1]) : 0;
    },

    _estimateTotalChaptersFromOutline(outline, chapters) {
        if (!outline) return 0;
        const chapterRefs = outline.match(/第(\d+)章/g);
        if (chapterRefs) {
            const maxChapter = Math.max(...chapterRefs.map(m => parseInt(m.replace(/[^\d]/g, ''))));
            if (maxChapter > 0) return maxChapter;
        }
        const stageRanges = outline.matchAll(/第(\d+)[-~至](\d+)章/g);
        let totalFromRanges = 0;
        for (const range of stageRanges) {
            const end = parseInt(range[2]);
            if (end > totalFromRanges) totalFromRanges = end;
        }
        if (totalFromRanges > 0) return totalFromRanges;
        if (chapters && chapters.length > 0) {
            return Math.max(chapters.length * 2, 30);
        }
        return 0;
    },

    _parsePerChapterWords(outline) {
        if (!outline) return '';
        const wcMatch = outline.match(/每章字数[：:]\s*(\d+[-~]\d+|\d+)\s*字/);
        return wcMatch ? wcMatch[1] + '字' : '';
    },

    /**
     * 从大纲中解析所有阶段及其章节范围，用于细纲下拉选择
     * 支持多种大纲格式：
     *   - "第N阶段：名称（第X-XX章）"
     *   - "#### 第N阶段：名称（第X-XX章）"
     *   - "阶段N：名称（第X-XX章）"
     * 返回 [{ label: '第一阶段：开局（第1-30章）', start: 1, end: 30, summary: '...' }, ...]
     */
    _parseOutlineStages(outline) {
        if (!outline) return [];

        const stages = [];

        // 匹配模式1：#### 第N阶段：名称（第X-XX章）
        // 匹配模式2：第N阶段：名称（第X-XX章）
        // 匹配模式3：阶段N：名称（第X-XX章）
        const stageRegex = /(?:#{1,4}\s*)?第([一二三四五六七八九十\d]+)阶段[：:]\s*(.+?)（第(\d+)[-~至](\d+)章）/g;
        let match;

        while ((match = stageRegex.exec(outline)) !== null) {
            const stageNum = match[1];
            const stageName = match[2].trim();
            const start = parseInt(match[3]);
            const end = parseInt(match[4]);

            // 提取该阶段的关键事件摘要（取阶段标题后的几行）
            const matchStart = match.index;
            const nextMatch = outline.slice(matchStart + match[0].length).match(/第[一二三四五六七八九十\d]+阶段|###\s/);
            const stageEnd = nextMatch ? matchStart + match[0].length + nextMatch.index : Math.min(outline.length, matchStart + 600);
            const stageContent = outline.slice(matchStart, stageEnd);

            // 提取关键事件
            const keyEvents = [];
            const eventRegex = /[●\-\d]+[\.\、]\s*(.+?)(?=\n|$)/g;
            let evtMatch;
            while ((evtMatch = eventRegex.exec(stageContent)) !== null) {
                if (evtMatch[1].length > 3) keyEvents.push(evtMatch[1].trim());
            }

            const label = `第${stageNum}阶段：${stageName}（第${start}-${end}章）`;
            stages.push({
                label,
                start,
                end,
                stageName,
                stageNum,
                summary: keyEvents.length > 0 ? keyEvents.slice(0, 4).join('；') : ''
            });
        }

        // 如果上面的正则没匹配到，尝试更宽松的模式
        if (stages.length === 0) {
            const looseRegex = /第(\d+)[-~至](\d+)章/g;
            let looseMatch;
            let idx = 1;
            while ((looseMatch = looseRegex.exec(outline)) !== null) {
                const start = parseInt(looseMatch[1]);
                const end = parseInt(looseMatch[2]);
                // 取匹配位置前后各50字作为摘要
                const ctxStart = Math.max(0, looseMatch.index - 30);
                const ctxEnd = Math.min(outline.length, looseMatch.index + looseMatch[0].length + 50);
                const ctx = outline.slice(ctxStart, ctxEnd).replace(/\n/g, ' ').substring(0, 80);

                stages.push({
                    label: `第${start}-${end}章`,
                    start,
                    end,
                    stageName: '',
                    stageNum: String(idx),
                    summary: ctx
                });
                idx++;
            }
        }

        return stages;
    },

    /**
     * 根据选中的章节范围，从大纲中提取对应的阶段描述内容
     */
    _extractOutlineForChapters(outline, startChapter, endChapter) {
        if (!outline) return '';

        // 先解析所有阶段
        const stages = this._parseOutlineStages(outline);
        let relevantContent = '';

        // 找到与章节范围重叠的阶段
        for (const stage of stages) {
            if (stage.start <= endChapter && stage.end >= startChapter) {
                // 从大纲中提取这个阶段的完整内容
                const stagePattern = new RegExp(
                    `(#{1,4}\\s*)?第${stage.stageNum.replace(/[一二三四五六七八九十]+/, '([一二三四五六七八九十]+)')}阶段[：:][\\s\\S]*?(?=#{1,4}\\s*第[一二三四五六七八九十\\d]+阶段|#{1,3}\\s[一二三四五六]|$)`,
                    'g'
                );
                const match = stagePattern.exec(outline);
                if (match) {
                    relevantContent += match[0].trim() + '\n\n';
                } else {
                    // 降级：用章节范围匹配
                    const rangePattern = new RegExp(
                        `第${stage.start}[-~至]${stage.end}章[\\s\\S]{0,500}`,
                        'g'
                    );
                    const rangeMatch = rangePattern.exec(outline);
                    if (rangeMatch) {
                        relevantContent += rangeMatch[0].trim() + '\n\n';
                    }
                }
            }
        }

        if (relevantContent) {
            return `\n## 📐 大纲中对应阶段\n${relevantContent.trim()}`;
        }

        // 降级：取大纲中与章节范围最相关的部分（全文搜索第X章相关内容）
        const chaptersNearby = [];
        for (let ch = Math.max(1, startChapter - 3); ch <= endChapter + 3; ch++) {
            const chIdx = outline.indexOf(`第${ch}章`);
            if (chIdx >= 0) {
                const snippet = outline.substring(Math.max(0, chIdx - 30), Math.min(outline.length, chIdx + 80));
                chaptersNearby.push(snippet.replace(/\n/g, ' '));
            }
        }
        if (chaptersNearby.length > 0) {
            return `\n## 大纲中相关章节\n${chaptersNearby.slice(0, 5).join('\n')}`;
        }

        // 最终降级
        return `\n## 大纲参考\n${outline.substring(0, 600)}`;
    },

    // ============ 描述生成 Prompt 构建 ============

    _buildDescPrompts(book, plans, chapters, userDesc) {
        const bookInfo = `小说《${book?.name || ''}》，类型：${book?.genre || '未分类'}，简介：${book?.desc || '无'}`;
        const tabLabels = { setting: '世界观设定', outline: '故事大纲·蓝图' };

        if (this.state.tab === 'setting') {
            return {
                systemPrompt: `你是一位资深世界观架构师。请根据用户的自由描述，生成结构化的世界观设定文档。

## 输出要求
- 用中文回答，条理清晰
- 使用 Markdown 标题分节
- 根据用户描述展开具体细节，不要空泛`,

                userPrompt: `## 作品信息
${bookInfo}
${plans.setting ? `\n## 已有设定（请在此基础上补充完善）\n${plans.setting.substring(0, 300)}` : ''}

## 用户对世界观的描述
${userDesc}

## 请基于以上描述，按以下结构生成完整的世界观设定：

### 一、时代与地理
### 二、社会与势力
### 三、力量体系（如有）
### 四、核心规则
### 五、伏笔与冲突种子

请直接输出内容，不需要额外解释。`
            };
        }

        if (this.state.tab === 'outline') {
            // 自适应：从描述中解析总章数，调整大纲细节深度
            const descTotalCh = this._parseTotalChapters(userDesc);
            const eventsPerStage = descTotalCh <= 0 ? '3-5' : (descTotalCh <= 50 ? '3-5' : (descTotalCh <= 200 ? '5-8' : '8-12'));
            const detailHint = descTotalCh <= 0 ? '' : `\n总章数：${descTotalCh}章，每阶段描述应详细，章节范围需明确标注。`;
            
            return {
                systemPrompt: `你是一位专业故事结构规划师。请根据用户的自由描述，生成结构化的故事大纲。

## 输出要求
- 用中文回答，条理清晰
- 使用 Markdown 标题分节
- 每阶段有 ${eventsPerStage} 个具体关键事件
- **必须明确标注每个阶段的章节范围**（如"第一阶段（第1-30章）"）`,

                userPrompt: `## 作品信息
${bookInfo}
${plans.setting ? `\n## 世界观设定\n${plans.setting.substring(0, 500)}` : ''}
${plans.outline ? `\n## 已有大纲（请在此基础上扩展细化）\n${plans.outline.substring(0, 300)}` : ''}

## 用户对故事的描述
${userDesc}${detailHint}

## 请基于以上描述，按以下结构生成完整的故事大纲：

### 一、一句话卖点
### 二、主线剧情（分阶段展开，每阶段标注章节范围）
${descTotalCh > 0 ? `请按 ${descTotalCh} 章的规模，将故事分为清晰阶段，每阶段标注章节范围，每个阶段 ${eventsPerStage} 个关键事件` : '请按起承转合展开，每阶段标注章节范围'}
### 三、人物弧光
### 四、节奏节点（标注关键爆点/反转时刻所在章节位置）

请直接输出内容，不需要额外解释。`
            };
        }

        // 降级：非 setting 也非 outline 时返回大纲 prompt
        const descTotalCh = this._parseTotalChapters(userDesc);
        const eventsPerStage = descTotalCh <= 0 ? '3-5' : (descTotalCh <= 50 ? '3-5' : (descTotalCh <= 200 ? '5-8' : '8-12'));
        const detailHint = descTotalCh <= 0 ? '' : `\n总章数：${descTotalCh}章，请据此自动划分阶段并明确每阶段章节范围。`;
        
        return {
            systemPrompt: `你是一位专业故事结构规划师。请根据用户的自由描述，生成融合蓝图的故事大纲。

## 输出要求
- 用中文回答，条理清晰
- 使用 Markdown 标题分节
- 每阶段有 ${eventsPerStage} 个具体关键事件
- **必须明确标注每个阶段的章节范围**（如"第一阶段（第1-30章）"）`,

            userPrompt: `## 作品信息
${bookInfo}
${plans.setting ? `\n## 世界观设定\n${plans.setting.substring(0, 500)}` : ''}
${plans.outline ? `\n## 已有大纲（请在此基础上扩展细化）\n${plans.outline.substring(0, 300)}` : ''}

## 用户对故事的描述
${userDesc}${detailHint}

## 请基于以上描述，按以下结构生成完整的故事大纲·蓝图：

### 一、一句话卖点
### 二、主线剧情（分阶段展开，每阶段标注章节范围）
${descTotalCh > 0 ? `请按 ${descTotalCh} 章的规模，将故事分为清晰阶段，每阶段标注章节范围，每个阶段 ${eventsPerStage} 个关键事件` : '请按起承转合展开，每阶段标注章节范围'}
### 三、人物弧光
### 四、节奏节点（标注关键爆点/反转时刻所在章节位置）

请直接输出内容，不需要额外解释。`
        };
    },

    // ============ 辅助方法 ============

    _countChars(text) {
        return text.replace(/\s/g, '').length;
    },

    /** 从章节规划文本中解析出最后一个被规划的章节号
     *  ★ 修复：只从规划文本中解析，不混入已有章节的 order。
     *  已有章节是"已写正文"，不等于"已规划"，混淆会导致首次规划跳过已写章节范围。
     */
    _getLastPlannedChapter(planText, chapters) {
        if (!planText && (!chapters || chapters.length === 0)) return 0;
        
        // 从规划文本中找章节号（这是真正已规划的范围）
        let maxFromPlan = 0;
        if (planText) {
            const matches = planText.match(/第(\d+)章/g);
            if (matches) {
                matches.forEach(m => {
                    const num = parseInt(m.replace(/[^\d]/g, ''));
                    if (num > maxFromPlan) maxFromPlan = num;
                });
            }
        }
        
        // 只有当规划文本为空时，才回退到已写章节的 order（首次规划场景）
        if (maxFromPlan > 0) return maxFromPlan;
        
        // 规划文本为空但有已写章节：返回已写章节的最大 order，作为规划起点参考
        if (chapters && chapters.length > 0) {
            return Math.max(...chapters.map(c => c.order || 0));
        }
        
        return 0;
    },

    /** 从大纲中提取指定章节范围对应的阶段描述 */
    _extractStageForChapters(outline, startChapter, endChapter) {
        if (!outline) return '';
        
        // 尝试匹配"第X-XX章"的模式，找到对应阶段
        const stagePattern = /(第[一二三四五六七八九十]+阶段[：:][^\n]*第(\d+)[-~至](\d+)章[\s\S]*?)(?=第[一二三四五六七八九十]+阶段|###\s|$)/g;
        let match;
        let relevantStages = [];
        
        while ((match = stagePattern.exec(outline)) !== null) {
            const stageStart = parseInt(match[2]);
            const stageEnd = parseInt(match[3]);
            if ((stageStart <= endChapter && stageEnd >= startChapter) || 
                (startChapter >= stageStart && startChapter <= stageEnd)) {
                relevantStages.push(match[1].substring(0, 300));
            }
        }
        
        if (relevantStages.length > 0) {
            return `\n## 当前对应的大纲阶段\n${relevantStages.join('\n\n')}`;
        }
        
        // 降级：取大纲中与章节范围相关的部分
        return `\n## 大纲参考\n${outline.substring(0, 600)}`;
    },

    /** 从用户描述中解析总章数 */
    _parseTotalChapters(desc) {
        if (!desc) return 0;
        const match = desc.match(/(\d+)\s*章/);
        return match ? parseInt(match[1]) : 0;
    },

    /** 
     * 根据总章数自适应计算 maxTokens
     * 策略：章数越多，AI 需要越多的输出空间
     *   - ≤30章：4096（默认）
     *   - ≤100章：6144
     *   - ≤300章：8192
     *   - ≤500章：12288
     *   - >500章：16384
     */
    _calcAdaptiveMaxTokens(totalChapters) {
        if (!totalChapters || totalChapters <= 30) return 4096;
        if (totalChapters <= 100) return 6144;
        if (totalChapters <= 300) return 8192;
        if (totalChapters <= 500) return 12288;
        return 16384;
    },

    /**
     * 根据总章数自动推算合理的阶段数
     * 策略：每阶段约 20-50 章不等，章数越多阶段越多
     */
    _calcAutoStageCount(totalChapters) {
        if (!totalChapters || totalChapters <= 20) return 3;
        if (totalChapters <= 60) return 4;
        if (totalChapters <= 120) return 5;
        if (totalChapters <= 200) return 6;
        if (totalChapters <= 350) return 8;
        return 10;
    },

    /**
     * 根据总章数和阶段数，生成建议的章节范围分配字符串
     * 策略：前面阶段稍多，后面阶段稍少（高潮和结局紧凑）
     */
    _calcStageChapterRanges(totalChapters, stageCount) {
        if (!totalChapters || !stageCount || stageCount <= 0) return '';
        const chaptersPerStage = Math.floor(totalChapters / stageCount);
        const remainder = totalChapters % stageCount;
        let ranges = [];
        let currentStart = 1;
        for (let i = 0; i < stageCount; i++) {
            // 前面几个阶段多分配余数章节
            let stageChapters = chaptersPerStage + (i < remainder ? 1 : 0);
            const stageEnd = Math.min(currentStart + stageChapters - 1, totalChapters);
            ranges.push(`第${currentStart}-${stageEnd}章`);
            currentStart = stageEnd + 1;
        }
        return ranges.join('、');
    },

    /**
     * 根据总章数自适应调整章节规划批处理大小
     * 策略：章数越多每批越大，减少手动点击"继续规划"次数
     *   - ≤30章：20章/批（1-2次）
     *   - ≤100章：25章/批（4次）
     *   - ≤300章：40章/批（8次）
     *   - ≤500章：50章/批（10次）
     *   - >500章：60章/批
     */
    _calcAdaptiveBatchSize(totalChapters) {
        if (!totalChapters || totalChapters <= 30) return 20;
        if (totalChapters <= 100) return 25;
        if (totalChapters <= 300) return 40;
        if (totalChapters <= 500) return 50;
        return 60;
    },

    /**
     * 根据总章数和阶段数，生成建议的爆点位置提示
     */
    _calcBurstPositions(totalChapters, stageCount) {
        if (!totalChapters || !stageCount) return '';
        const ranges = [];
        // 小爆点：每 3-8 章
        for (let i = 1; i <= stageCount; i++) {
            const stageStart = Math.floor((i - 1) * totalChapters / stageCount) + 1;
            const stageEnd = Math.floor(i * totalChapters / stageCount);
            const mid = Math.floor((stageStart + stageEnd) / 2);
            ranges.push(`第${mid}章附近`);
        }
        // 大高潮：70%-85%
        const climaxStart = Math.floor(totalChapters * 0.7);
        const climaxEnd = Math.floor(totalChapters * 0.85);
        ranges.push(`大高潮在第${climaxStart}-${climaxEnd}章之间`);
        return '建议爆点位置：' + ranges.join('、');
    },

    _save() {
        const textarea = document.getElementById('planTextarea');
        if (!textarea) return;
        const content = textarea.value.trim();
        Storage.savePlan(this.state.bookId, this.state.tab, content);
        showToast('已保存');
        this._renderContent();
    }
};
