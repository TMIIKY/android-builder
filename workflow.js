/**
 * 开放小说创作助手 - 工作流模块
 * 严格按 Skill 规范：设定→大纲→Spec→正文→评审→修订
 */

const Workflow = {
    state: {
        active: false, mode: '', bookId: null,
        autoChapterCount: 0, autoCompleted: 0,
        autoCurrentChapter: 0, autoShouldStop: false
    },

    async run(mode, bookId) {
        const book = Storage.getBook(bookId);
        if (!book) { showToast('请先选择一本书'); return; }
        this.state.bookId = bookId;
        this.state.mode = mode;

        const modal = document.getElementById('workflowResultModal');
        const title = document.getElementById('wfResultTitle');
        const body = document.getElementById('wfResultBody');
        const footer = document.getElementById('wfResultFooter');

        const modeNames = {
            'setting': '设定管理', 'outline': '大纲·蓝图生成',
            'chapter_plan': '章节Spec规划（已融入大纲）',
            'generate': '正文生成', 'review': '评审反馈', 'auto_write': '批量推进'
        };
        title.textContent = modeNames[mode] || '创作助手';
        body.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>AI正在创作中...</p></div>';
        footer.style.display = 'none';
        modal.classList.add('active');

        try {
            let result = '';
            switch (mode) {
                case 'setting': result = await this._runSetting(bookId); break;
                case 'outline': result = await this._runOutline(bookId); break;
                case 'chapter_plan': result = await this._runChapterPlan(bookId); break;
                case 'generate': result = await this._runGenerate(bookId); break;
                case 'review': result = await this._runReview(bookId); break;
                case 'auto_write':
                    document.getElementById('workflowResultModal').classList.remove('active');
                    showAutoWriteModal();
                    return;
            }
            body.innerHTML = `<div class="wf-result-content">${this._formatResult(result)}</div>`;
            footer.style.display = 'flex';
            const saveBtn = document.getElementById('wfSaveBtn');
            saveBtn.onclick = () => this._saveResultToBook(bookId, mode, result);
        } catch (error) {
            body.innerHTML = `<div class="error-message">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <p>生成失败：${error.message}</p></div>`;
            footer.style.display = 'flex';
            document.getElementById('wfSaveBtn').style.display = 'none';
        }
    },

    async _runSetting(bookId) {
        const result = await AIService.generateSetting(bookId);
        Storage.savePlan(bookId, 'setting', result);
        return result;
    },

    async _runOutline(bookId) {
        const result = await AIService.generateOutline(bookId);
        Storage.savePlan(bookId, 'outline', result);
        return result;
    },

    // _runChapterDraft 已随章节细纲功能移除

    async _runChapterPlan(bookId) {
        const chapters = Storage.getChapters(bookId);
        const nextNum = chapters.length + 1;
        const spec = await AIService.generateChapterSpec(bookId, nextNum);
        Storage.saveChapterSpec(bookId, nextNum, spec);
        Storage.savePlan(bookId, 'chapter_plan', spec);
        return `## 第${nextNum}章 Spec（章节规格）\n\n${spec}`;
    },

    async _runGenerate(bookId) {
        const chapters = Storage.getChapters(bookId);
        const nextNum = chapters.length + 1;
        // 先生成Spec
        let spec = Storage.getChapterSpec(bookId, nextNum);
        if (!spec) {
            spec = await AIService.generateChapterSpec(bookId, nextNum);
            Storage.saveChapterSpec(bookId, nextNum, spec);
        }
        // 基于Spec生成正文
        const content = await AIService.generateChapterContent(bookId, nextNum, spec);
        // 自动提取标题并保存
        const title = this._extractTitle(content) || `第${nextNum}章`;
        Storage.addChapter(bookId, { title, content, status: 'draft' });
        Storage.updateBook(bookId, { chapterCount: Storage.getChapters(bookId).length });
        return `## 第${nextNum}章 正文\n\n${content.substring(0, 500)}...\n\n*(已自动保存到书籍)*`;
    },

    async _runReview(bookId) {
        const chapters = Storage.getChapters(bookId);
        if (chapters.length === 0) throw new Error('没有可评审的章节');
        const last = chapters[chapters.length - 1];
        if (!last.content) throw new Error('最新章节暂无内容');
        const review = await AIService.reviewChapter(bookId, last.content, last.title);
        Storage.saveChapterReview(bookId, last.order, review);
        return review;
    },

    // ============ 批量推进（Skill规范：Spec→生成→评审→修订循环） ============
    async startAutoWrite(bookId, chapterCount, wordCount) {
        this.state.autoShouldStop = false;
        this.state.autoCompleted = 0;
        this.state.autoChapterCount = chapterCount;
        this.state.bookId = bookId;

        const modal = document.getElementById('workflowResultModal');
        const title = document.getElementById('wfResultTitle');
        const body = document.getElementById('wfResultBody');
        const footer = document.getElementById('wfResultFooter');
        title.textContent = '批量推进写作';
        modal.classList.add('active');
        footer.style.display = 'none';

        const chapters = Storage.getChapters(bookId);
        const startNum = chapters.length + 1;
        let report = `# 批量写作报告\n\n目标：${chapterCount}章（第${startNum}-${startNum + chapterCount - 1}章）\n\n`;
        let passedCount = 0, revisedCount = 0, skippedCount = 0;

        for (let i = 0; i < chapterCount; i++) {
            if (this.state.autoShouldStop) break;
            const chNum = startNum + i;
            this.state.autoCurrentChapter = chNum;

            body.innerHTML = `<div class="auto-write-progress">
                <div class="progress-bar-container"><div class="progress-bar" style="width:${(i / chapterCount) * 100}%"></div></div>
                <p>第 ${chNum} 章（${i + 1}/${chapterCount}）</p>
                <p style="font-size:12px;color:var(--text-muted)">[1/4] 生成Spec...</p>
                <div class="loading-spinner"><div class="spinner"></div></div></div>`;

            try {
                // Step 1: 生成Spec
                body.innerHTML = body.innerHTML.replace('[1/4] 生成Spec...', '[1/4] ✓ Spec完成');
                body.innerHTML = body.innerHTML.replace('Spec...</p>', 'Spec完成</p>');
                const spec = await AIService.generateChapterSpec(bookId, chNum);
                Storage.saveChapterSpec(bookId, chNum, spec);

                // Step 2: 基于Spec生成正文
                body.innerHTML = body.innerHTML.replace('[1/4] ✓ Spec完成', '[2/4] 生成正文...');
                const content = await AIService.generateChapterContent(bookId, chNum, spec, '', wordCount);

                // Step 3: 评审
                body.innerHTML = body.innerHTML.replace('[2/4] 生成正文...', '[3/4] 评审中...');
                const review = await AIService.reviewChapter(bookId, content, `第${chNum}章`);
                const score = AIService._parseReviewScore(review);
                const hasP0 = AIService._checkP0Issues(review);

                // Step 4: 必要时修订
                let finalContent = content;
                let revCount = 0;
                while ((score < 85 || hasP0) && revCount < 2 && !this.state.autoShouldStop) {
                    revCount++;
                    body.innerHTML = body.innerHTML.replace('[3/4] 评审中...', `[4/4] 修订中(${revCount}/2)...`);
                    const revPrompt = AIService._buildRevisionPrompt(review, hasP0);
                    finalContent = await AIService.reviseContent(bookId, finalContent, revPrompt);
                    const reReview = await AIService.reviewChapter(bookId, finalContent, `第${chNum}章(修订${revCount})`);
                    const newScore = AIService._parseReviewScore(reReview);
                    const newHasP0 = AIService._checkP0Issues(reReview);
                    if (newScore >= 85 && !newHasP0) break;
                }

                // 保存
                const title = this._extractTitle(finalContent) || `第${chNum}章`;
                Storage.addChapter(bookId, { title, content: finalContent, status: 'draft' });
                Storage.updateBook(bookId, { chapterCount: Storage.getChapters(bookId).length });
                Storage.saveChapterReview(bookId, chNum, review);

                this.state.autoCompleted++;
                const passed = score >= 85 && !hasP0;
                if (passed) passedCount++;
                if (revCount > 0) revisedCount++;
                if (!passed && revCount >= 2) skippedCount++;

                report += `### 第${chNum}章 ${passed ? '✓' : (revCount > 0 ? '⚠️ 修订后通过' : '❌ 跳过')}\n`;
                report += `- 评分：${score}/100\n- 字数：${finalContent.length}\n`;
                if (revCount > 0) report += `- 修订${revCount}次\n`;
                report += '\n';

            } catch (error) {
                report += `### 第${chNum}章 ❌ 失败\n- 错误：${error.message}\n\n`;
                skippedCount++;
            }

            await this._sleep(500);
        }

        // 完成报告
        report += `\n## 总结\n- 成功：${passedCount}章 | 修订后通过：${revisedCount}章 | 跳过：${skippedCount}章\n`;
        body.innerHTML = `<div class="wf-result-content">${this._formatResult(report)}</div>`;
        footer.style.display = 'flex';
        document.getElementById('wfSaveBtn').style.display = 'none';
    },

    stopAutoWrite() { this.state.autoShouldStop = true; },

    _extractTitle(content) {
        if (!content) return null;
        const firstLine = content.split('\n')[0]?.replace(/【.*?】/g, '').trim();
        if (firstLine && firstLine.length > 3 && firstLine.length < 30) return firstLine;
        if (firstLine && firstLine.length >= 30) return firstLine.substring(0, 15) + '…';
        return null;
    },

    _formatResult(text) {
        if (!text) return '<p>无内容</p>';
        return text
            .replace(/\n/g, '<br>')
            .replace(/【(.+?)】/g, '<strong class="highlight">【$1】</strong>')
            .replace(/^### (.+)$/gm, '<h4>$1</h4>')
            .replace(/^## (.+)$/gm, '<h3>$1</h3>')
            .replace(/^# (.+)$/gm, '<h2>$1</h2>')
            .replace(/^- (.+)$/gm, '<li>$1</li>');
    },

    _saveResultToBook(bookId, mode, result) {
        if (mode === 'setting' || mode === 'outline' || mode === 'chapter_plan') {
            const planKey = mode === 'chapter_plan' ? 'chapter_plan' : mode;
            Storage.savePlan(bookId, planKey, result);
            showToast('已保存到创作规划');
        } else if (mode === 'generate') {
            showToast('正文已自动保存');
        } else if (mode === 'review') {
            showToast('评审已保存');
        }
        document.getElementById('workflowResultModal').classList.remove('active');
        if (currentBookId === bookId) renderBookDetail(bookId);
    },

    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
};
