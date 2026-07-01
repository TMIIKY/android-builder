/**
 * 灵墨 · 应用主逻辑
 * 页面架构：3主屏 (chat/bookshelf/settings) + 作品详情 + 阅读器
 * 底部导航：灵墨 | 书架 | 我的
 */

// ===== 全局状态 =====
let currentBookId = null;
let currentChapterIndex = 0;
let currentTab = 'chat';
let editingBookId = null;

// ===== 页面映射 =====
const SCREENS = {
    chat:      'chatScreen',
    bookshelf: 'bookshelfScreen',
    settings:  'settingsScreen',
    detail:    'detailScreen',
    reader:    'readerScreen'
};

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    _initApp();
    _initBackHandler();
});

function _initApp() {
    _applyTheme();
    _applyFontSize();
    _initStorageErrorListener();
    Brainstorm.init();
    renderBookshelf();
    renderModelCount();
    switchTab('chat');
}

/**
 * 监听存储错误事件，当 localStorage 写满时提示用户
 */
function _initStorageErrorListener() {
    window.addEventListener('storage-error', (e) => {
        const { type, bookId, chapterCount, error } = e.detail || {};
        if (error === 'STORAGE_FULL') {
            showToast('⚠️ 存储空间不足！请导出备份后清理旧数据');
            console.error(`[Storage] 写入失败: type=${type}, bookId=${bookId}, chapters=${chapterCount}`);
        }
    });
}

// ===== 返回键 / 侧滑返回拦截（JavascriptInterface 桥接方案） =====
function _initBackHandler() {
    // 暴露给原生层 onBackPressed 调用的方法
    // MainActivity 在 stackCount > 0 时执行此方法
    window._handleBackPressed = function() {
        _handleBackAction();
    };
}

/**
 * 处理返回操作的核心逻辑
 * 每次处理一级返回时，同步调用 popStack() 通知原生层减少栈深度
 */
function _handleBackAction() {
    // 1. 如果有打开的 Sheet 弹窗，关闭它
    const openSheet = document.querySelector('.sheet-overlay.open');
    if (openSheet) {
        openSheet.classList.remove('open');
        _popNativeStack();
        return;
    }

    // 2. 如果在阅读器，返回详情页
    const readerScreen = document.getElementById('readerScreen');
    if (readerScreen && readerScreen.classList.contains('active')) {
        closeReader();
        _popNativeStack();
        return;
    }

    // 3. 如果在详情页，返回书架
    const detailScreen = document.getElementById('detailScreen');
    if (detailScreen && detailScreen.classList.contains('active')) {
        switchTab('bookshelf');
        _popNativeStack();
        return;
    }

    // 4. 如果在引导页（必须确认引导页处于激活状态）
    const guidePage = document.getElementById('guidePage');
    if (guidePage && guidePage.classList.contains('active') && typeof Guide !== 'undefined' && Guide._goBack && Guide.state && Guide.state.mode) {
        Guide._goBack();
        _popNativeStack();
        return;
    }

    // 5. 已经在三个主Tab页（灵墨/书架/我的）任一层级，通知原生允许退出
    if (window.AndroidBackStack) {
        window.AndroidBackStack.resetStack();
    }
}

/** 通知原生层减少栈深度 */
function _popNativeStack() {
    if (window.AndroidBackStack) {
        window.AndroidBackStack.popStack();
    }
}

/** 通知原生层增加栈深度（进入子页面时调用） */
function _pushNativeStack() {
    if (window.AndroidBackStack) {
        window.AndroidBackStack.pushStack();
    }
}

// ===== 页面切换 =====
function switchTab(tab) {
    currentTab = tab;

    // 更新底部导航
    document.querySelectorAll('.bb-item').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tab);
    });

    // 隐藏所有主屏
    ['chatScreen','bookshelfScreen','settingsScreen','detailScreen','readerScreen'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });

    // 显示底部导航
    document.getElementById('bottomBar').style.display = 'flex';

    // 更新顶栏
    const btnBack = document.getElementById('btnBack');
    const tbTitle = document.getElementById('tbTitle');
    btnBack.classList.remove('visible');
    tbTitle.textContent = '灵墨';

    // 显示目标页
    const screenId = SCREENS[tab];
    if (screenId) {
        document.getElementById(screenId).classList.add('active');
    }

    // 特殊处理
    if (tab === 'chat') {
        Brainstorm.init();
    } else if (tab === 'bookshelf') {
        currentBookId = null;
        currentChapterIndex = 0;
        renderBookshelf();
    } else if (tab === 'settings') {
        renderModelCount();
    }
}

function goBack() {
    _handleBackAction();
}

// ===== 灵墨对话 =====
function quickChat(text) {
    const input = document.getElementById('chatInput');
    input.value = text;
    sendChat();
}

function handleChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
    }
}

function sendChat() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    // 隐藏空状态
    const empty = document.getElementById('chatEmpty');
    if (empty) empty.style.display = 'none';

    // 添加用户消息
    addChatBubble('user', text);
    input.value = '';
    input.style.height = 'auto';

    // 调用 Brainstorm
    if (typeof Brainstorm !== 'undefined' && Brainstorm.send) {
        Brainstorm.send(text);
    }
}

function addChatBubble(role, text) {
    const container = document.getElementById('chatMessages');
    const row = document.createElement('div');
    row.className = 'msg-row ' + role;

    if (role === 'ai') {
        row.innerHTML = `<div class="msg-avatar ai-avatar">
            <svg width="22" height="22" viewBox="0 0 48 48"><path fill="currentColor" d="M31.833 13.112a5.36 5.36 0 0 0-2.544-1.805l-2.603-.845a1.028 1.028 0 0 1 0-1.937l2.602-.845a5.36 5.36 0 0 0 3.323-3.33l.022-.064l.845-2.6a1.027 1.027 0 0 1 1.94 0l.845 2.6A5.36 5.36 0 0 0 39.66 7.68l2.602.845l.052.013a1.028 1.028 0 0 1 0 1.937l-2.602.845a5.36 5.36 0 0 0-3.397 3.394l-.846 2.6l-.025.064a1.027 1.027 0 0 1-1.538.433a1.03 1.03 0 0 1-.375-.497l-.846-2.6a5.4 5.4 0 0 0-.852-1.602m14.776 6.872l-1.378-.448a2.84 2.84 0 0 1-1.797-1.796l-.448-1.377a.544.544 0 0 0-1.027 0l-.448 1.377a2.84 2.84 0 0 1-1.77 1.796l-1.378.448a.545.545 0 0 0 0 1.025l1.378.448q.227.075.438.188l.003.015a2.84 2.84 0 0 1 1.357 1.61l.448 1.377a.545.545 0 0 0 1.01.039v-.01l.016-.039l.448-1.377a2.84 2.84 0 0 1 1.798-1.796l1.378-.448a.545.545 0 0 0 0-1.025zM29.93 5q.042-.039.081-.081A20 20 0 0 0 24 4C12.954 4 4 12.954 4 24c0 3.448.873 6.695 2.411 9.528L4.07 41.766c-.375 1.318.843 2.537 2.162 2.162l8.236-2.342A19.9 19.9 0 0 0 24 44c10.16 0 18.551-7.577 19.831-17.388A2.55 2.55 0 0 1 41 26.54a2.54 2.54 0 0 1-.89-1.35l-.44-1.37a.9.9 0 0 0-.2-.33a1 1 0 0 0-.2-.15l-.12-.06l-1.42-.46a2.55 2.55 0 0 1-1.7-2.4c0-.346.075-.687.22-1a3 3 0 0 1-3.47 0a3 3 0 0 1-1.12-1.51l-.84-2.59a3.2 3.2 0 0 0-.54-1A3 3 0 0 0 30 14a3.3 3.3 0 0 0-1.35-.79L26 12.35a3 3 0 0 1-1.44-4.58a3.1 3.1 0 0 1 1.51-1.12l2.57-.83A3.4 3.4 0 0 0 29.93 5"/></svg>
        </div><div class="msg-bubble ai">${escapeHtml(text)}</div>`;
    } else {
        row.innerHTML = `<div class="msg-bubble user">${escapeHtml(text)}</div>
        <div class="msg-avatar user-avatar">
            <svg width="22" height="22" viewBox="0 0 24 24"><defs><linearGradient id="userGrad2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="var(--accent)"/><stop offset="100%" stop-color="var(--accent-strong)"/></linearGradient></defs><circle cx="12" cy="8" r="5" fill="url(#userGrad2)" opacity="0.9"/><path d="M4 22c0-4.418 3.582-8 8-8s8 3.582 8 8" fill="url(#userGrad2)" opacity="0.9"/></svg>
        </div>`;
    }

    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== 书架 =====
function renderBookshelf() {
    const books = typeof Storage !== 'undefined' ? Storage.getBooks() : [];
    const grid = document.getElementById('bookGrid');
    const empty = document.getElementById('shelfEmpty');

    if (books.length === 0) {
        grid.innerHTML = '';
        if (empty) empty.style.display = '';
        return;
    }
    if (empty) empty.style.display = 'none';

    grid.innerHTML = books.map(book => {
        const chapters = typeof Storage !== 'undefined' ? Storage.getChapters(book.id) : [];
        // 进度基于已完成章节数（有内容的章节）和规划总数
        const completedChapters = chapters.filter(ch => ch.content && ch.status !== 'failed').length;
        let progress = 0;
        if (completedChapters > 0) {
            // 如果有章节规划，用规划总数估算；否则基于已有章节数
            const plans = typeof Storage !== 'undefined' ? Storage.getPlans(book.id) : {};
            let estimatedTotal = chapters.length;
            if (plans.chapter_plan) {
                const planChapters = (plans.chapter_plan.match(/第\d+章/g) || []).length;
                if (planChapters > chapters.length) estimatedTotal = planChapters;
            }
            progress = Math.min(99, Math.round(completedChapters / Math.max(estimatedTotal, completedChapters) * 100));
        }
        const coverStyle = book.coverStyle || (typeof CoverEngine !== 'undefined' ? CoverEngine.generate(book) : null);
        const coverHTML = coverStyle
            ? CoverEngine.renderHTML(book, coverStyle)
            : `<div class="book-card-cover" style="background:linear-gradient(135deg,#6366f1,#6366f1dd)">${book.name.substring(0,4)}</div>`;
        return `
        <div class="book-card" onclick="showBookDetail('${book.id}')" ontouchstart="handleBookTouch(event, this)" ontouchend="handleBookTouchEnd(event, this, '${book.id}')">
            ${coverHTML}
            <div class="book-card-info">
                <div class="book-card-name">${book.name}</div>
                <div class="book-card-meta">${book.genre||'未分类'} · ${chapters.length}章</div>
            </div>
            <div class="book-card-progress"><div class="book-card-progress-bar" style="width:${progress}%"></div></div>
            <div class="book-card-delete" onclick="event.stopPropagation();confirmDeleteBook('${book.id}')">删除</div>
        </div>`;
    }).join('');

}

// 左滑检测
let touchStartX = 0;
let touchStartY = 0;
function handleBookTouch(e, card) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
}
function handleBookTouchEnd(e, card, bookId) {
    const dx = (e.changedTouches[0]?.clientX || touchStartX) - touchStartX;
    const dy = (e.changedTouches[0]?.clientY || touchStartY) - touchStartY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) card.classList.add('swiped');
        else card.classList.remove('swiped');
    }
}

// ===== 作品详情 =====
function showBookDetail(bookId) {
    if (!bookId) return;

    // 直接从 Storage 读数据
    const book = Storage.getBook(bookId);
    if (!book) {
        console.warn('showBookDetail: 找不到书籍', bookId);
        switchTab('bookshelf');
        return;
    }

    // 更新全局状态
    currentBookId = bookId;
    currentTab = 'bookshelf';

    // 通知原生层：进入子页面，栈深度+1
    _pushNativeStack();

    // 隐藏所有屏幕，显示详情
    ['chatScreen','bookshelfScreen','settingsScreen','readerScreen'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
    document.getElementById('detailScreen').classList.add('active');
    document.getElementById('bottomBar').style.display = 'none';
    document.getElementById('btnBack').classList.add('visible');
    document.getElementById('tbTitle').textContent = book.name;

    // ★ 关键：先清空 detailScreen 所有子元素，再重建 DOM
    const detailScreen = document.getElementById('detailScreen');
    detailScreen.innerHTML = '';
    // 重建详情页结构（确保干净）
    detailScreen.innerHTML = `
        <div class="detail-cover" id="detailCover" style="min-height:160px;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;overflow:hidden">
            <h2 class="detail-cover-title" id="detailBookName" style="z-index:1;position:relative"></h2>
            <p class="detail-cover-meta" id="detailBookMeta" style="z-index:1;position:relative"></p>
        </div>
        <div class="detail-actions">
            <button class="btn btn-outline btn-sm" onclick="showCreateBookModal(currentBookId)">✏️ 编辑信息</button>
            <button class="btn btn-outline btn-sm" onclick="openPlanManager()">📝 创作规划</button>
            <button class="btn btn-outline btn-sm" onclick="showExportBookModal()">📤 导出</button>
        </div>
        <div class="detail-chapters">
            <h3 class="detail-section-title">章节 · <span id="detailChapterCount">0</span>章</h3>
            <div class="chapter-list" id="chapterList"></div>
            <button class="btn btn-accent btn-full" onclick="showCreateChapterModal()" style="margin-top:12px">+ 生成章节</button>
        </div>
    `;

    // 从 Storage 读取当前书的章节，自动修复历史截断标题
    let chapters = Storage.getChapters(bookId);
    let needsSave = false;
    chapters.forEach(ch => {
        if (ch.content && ch.content.length > 100 && ch.title && ch.title.length <= 10) {
            const fixed = _generateTitle(ch.content, ch.order);
            if (fixed && fixed.length > ch.title.length) {
                ch.title = fixed;
                needsSave = true;
            }
        }
    });
    if (needsSave) Storage.saveChapters(bookId, chapters);

    document.getElementById('detailBookName').textContent = book.name;
    document.getElementById('detailBookMeta').textContent = `${book.genre||'未分类'} · ${chapters.length}章`;
    document.getElementById('detailChapterCount').textContent = chapters.length;

    // 渲染封面
    const coverContainer = document.getElementById('detailCover');
    const coverStyle = book.coverStyle || (typeof CoverEngine !== 'undefined' ? CoverEngine.generate(book) : null);
    if (coverStyle && typeof CoverEngine !== 'undefined') {
        coverContainer.innerHTML = CoverEngine.renderHTML(book, coverStyle);
    } else {
        coverContainer.innerHTML = `<div class="book-card-cover" style="background:linear-gradient(135deg,#6366f1,#6366f1dd);min-height:180px;display:flex;align-items:center;justify-content:center;font-size:24px;color:#fff">${book.name.substring(0,4)}</div>`;
    }

    // 渲染章节列表（先用 _hasContent 标记显示占位，再异步加载字数）
    const list = document.getElementById('chapterList');
    list.innerHTML = chapters.map((ch, i) => `
        <div class="chapter-item" onclick="openReader(${i})">
            <span class="chapter-item-order">${String(i+1).padStart(2,'0')}</span>
            <div class="chapter-item-info">
                <div class="chapter-item-title-row">
                    <span class="chapter-item-title" id="chapterTitle_${ch.id}">${ch.title||'未命名'}</span>
                    <button class="chapter-item-edit-btn" onclick="event.stopPropagation();startEditChapterTitle('${ch.id}')" title="编辑标题">✎</button>
                    <button class="chapter-item-delete-btn" onclick="event.stopPropagation();confirmDeleteChapter('${ch.id}')" title="删除章节">✕</button>
                </div>
                <div class="chapter-item-meta" id="chapterMeta_${ch.id}">${ch._hasContent ? '...' : '0'} 字</div>
            </div>
        </div>
    `).join('');

    // ★ 异步加载 IndexedDB 中的正文，更新字数显示
    Storage.loadChapterContents(bookId, chapters).then(() => {
        chapters.forEach((ch, i) => {
            const metaEl = document.getElementById('chapterMeta_' + ch.id);
            if (metaEl) {
                metaEl.textContent = (ch.content || '').length + ' 字';
            }
        });
    });

    // 检查章节规划覆盖：如果已写章节接近规划末尾，提示继续规划
    const plans = Storage.getPlans(bookId);
    if (plans.chapter_plan && chapters.length > 0) {
        // 从规划文本中找最后一个被规划的章节号
        const planMatches = plans.chapter_plan.match(/第(\d+)章/g);
        let lastPlanned = 0;
        if (planMatches) {
            planMatches.forEach(m => {
                const num = parseInt(m.replace(/[^\d]/g, ''));
                if (num > lastPlanned) lastPlanned = num;
            });
        }
        const lastWritten = chapters.length;
        // 如果已写章节离规划末尾不到5章，或已超过规划
        if (lastPlanned > 0 && lastWritten >= lastPlanned - 3) {
            const hintEl = document.createElement('div');
            hintEl.className = 'plan-continue-hint';
            hintEl.style.cssText = 'margin-top:12px;padding:10px 14px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:8px;font-size:13px;color:var(--accent);text-align:center;cursor:pointer';
            hintEl.innerHTML = `⚠️ 章节规划只覆盖到第 ${lastPlanned} 章，当前已写到第 ${lastWritten} 章<br><b>点击继续规划后续章节 →</b>`;
            hintEl.onclick = () => { if (typeof PlanManager !== 'undefined') { PlanManager.open(bookId); setTimeout(() => PlanManager.switchTab('outline'), 300); } };
            list.appendChild(hintEl);
        }
    }
}

/** 开始编辑章节标题 */
function startEditChapterTitle(chapterId) {
    const titleEl = document.getElementById('chapterTitle_' + chapterId);
    if (!titleEl) return;
    const currentTitle = titleEl.textContent;

    // 替换为 input
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentTitle;
    input.className = 'chapter-title-input';
    input.maxLength = 30;
    input.style.cssText = 'font-size:14px;font-weight:500;color:var(--text-primary);border:none;border-bottom:1px solid var(--accent);background:transparent;width:100%;outline:none;padding:2px 0';

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const saveTitle = () => {
        const newTitle = input.value.trim();
        const span = document.createElement('span');
        span.className = 'chapter-item-title';
        span.id = 'chapterTitle_' + chapterId;
        span.textContent = newTitle || '未命名';
        input.replaceWith(span);
        updateChapterTitle(chapterId, newTitle);
    };

    input.addEventListener('blur', saveTitle);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = currentTitle; input.blur(); }
    });
}

// ===== 新建/编辑作品 =====
function showCreateBookModal(bookId) {
    editingBookId = bookId || null;
    const sheet = document.getElementById('bookMetaSheet');
    document.getElementById('bookMetaTitle').textContent = bookId ? '编辑作品' : '新建作品';
    if (bookId) {
        const book = Storage.getBook(bookId);
        if (book) {
            document.getElementById('inputBookName').value = book.name || '';
            document.getElementById('inputBookGenre').value = book.genre || '';
            document.getElementById('inputBookDesc').value = book.desc || '';
            // 恢复临时封面样式
            _tempCoverStyle = book.coverStyle || null;
            _updateCoverPreview();
        }
    } else {
        document.getElementById('inputBookName').value = '';
        document.getElementById('inputBookGenre').value = '';
        document.getElementById('inputBookDesc').value = '';
        _tempCoverStyle = null;
        _updateCoverPreview();
    }
    openSheet('bookMetaSheet');
}

// 临时封面样式（编辑期间）
let _tempCoverStyle = null;

function _updateCoverPreview() {
    const name = document.getElementById('inputBookName').value.trim();
    const genre = document.getElementById('inputBookGenre').value;
    if (!name || !genre) {
        document.getElementById('coverPreviewBox').innerHTML = '<div class="cover-preview-placeholder">选择类型后自动生成封面</div>';
        return;
    }
    const style = _tempCoverStyle || (typeof CoverEngine !== 'undefined' ? CoverEngine.generate({ name, genre }) : null);
    if (style && typeof CoverEngine !== 'undefined') {
        document.getElementById('coverPreviewBox').innerHTML = CoverEngine.renderHTML({ name, genre }, style);
        document.getElementById('coverPreviewBox').querySelector('.book-card-cover').style.height = '100%';
    }
}

// 类型选择时自动更新封面预览
document.addEventListener('change', (e) => {
    if (e.target.id === 'inputBookGenre' || e.target.id === 'inputBookName') {
        _tempCoverStyle = null;
        _updateCoverPreview();
    }
});

async function aiGenerateCover() {
    const name = document.getElementById('inputBookName').value.trim();
    const genre = document.getElementById('inputBookGenre').value;
    if (!name || !genre) { showToast('请先填写作品名称和类型'); return; }

    showToast('正在生成封面…');
    if (typeof CoverEngine !== 'undefined') {
        const style = await CoverEngine.aiGenerate({ name, genre, desc: document.getElementById('inputBookDesc').value.trim() });
        _tempCoverStyle = style;
        _updateCoverPreview();
        showToast('封面已生成');
    } else {
        showToast('封面引擎未加载');
    }
}

function saveBookMeta() {
    const name = document.getElementById('inputBookName').value.trim();
    const genre = document.getElementById('inputBookGenre').value;
    const desc = document.getElementById('inputBookDesc').value.trim();
    if (!name) { showToast('请输入作品名称'); return; }

    if (typeof Storage === 'undefined') { showToast('存储模块未加载'); return; }

    // 保存封面样式
    const coverStyle = _tempCoverStyle || (typeof CoverEngine !== 'undefined' ? CoverEngine.generate({ name, genre }) : null);
    const bookData = { name, genre, desc, coverStyle };

    if (editingBookId) {
        const book = Storage.getBook(editingBookId);
        if (book) {
            book.name = name; book.genre = genre; book.desc = desc; book.coverStyle = coverStyle;
            const books = Storage.getBooks();
            const idx = books.findIndex(b => b.id === editingBookId);
            if (idx >= 0) { books[idx] = book; Storage.saveBooks(books); }
        }
    } else {
        Storage.addBook(bookData);
    }
    _tempCoverStyle = null;
    editingBookId = null;
    closeSheet('bookMetaSheet');
    renderBookshelf();
    if (currentTab === 'bookshelf') renderBookshelf();
    showToast('保存成功');
}

// ===== 删除作品 =====
function confirmDeleteBook(bookId) {
    const book = Storage.getBook(bookId);
    if (!book) return;
    document.getElementById('confirmMessage').textContent = `确定删除《${book.name}》？此操作不可恢复。`;
    document.getElementById('btnConfirmDelete').onclick = () => {
        doDeleteBook(bookId);
        closeSheet('confirmSheet');
    };
    openSheet('confirmSheet');
}

function doDeleteBook(bookId) {
    const books = Storage.getBooks().filter(b => b.id !== bookId);
    Storage.saveBooks(books);
    Storage.deleteBook(bookId);  // 清理 localStorage 和 IndexedDB
    currentBookId = null;
    renderBookshelf();
    showToast('已删除');
}

// ===== 阅读器 =====
let _readerLock = false;

async function openReader(chapterIndex) {
    // 并发锁：防止快速点击导致状态混乱
    if (_readerLock) return;
    _readerLock = true;

    try {
        currentChapterIndex = chapterIndex;
        if (!currentBookId) return;

        const chapters = Storage.getChapters(currentBookId);
        if (!chapters || chapterIndex >= chapters.length) return;

        // 通知原生层：进入子页面，栈深度+1
        _pushNativeStack();

        // 切换屏幕
        ['chatScreen','bookshelfScreen','settingsScreen','detailScreen'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('active');
        });
        document.getElementById('readerScreen').classList.add('active');
        document.getElementById('bottomBar').style.display = 'none';
        document.getElementById('btnBack').classList.add('visible');

        // 如果章节正文为空，从 IndexedDB 加载
        const chapter = chapters[chapterIndex];
        if (!chapter.content) {
            chapter.content = await Storage.loadChapterContent(currentBookId, chapter.id);
        }

        renderReaderContent(chapter, chapterIndex, chapters.length);
    } finally {
        _readerLock = false;
    }
}

function renderReaderContent(chapter, idx, total) {
    document.getElementById('tbTitle').textContent = `第${idx+1}章/${total}章`;
    document.getElementById('readerTitle').textContent = chapter.title || '';

    const body = document.getElementById('readerBody');
    const content = chapter.content || '（暂无内容）';
    body.innerHTML = content.split('\n').filter(p => p.trim()).map(p => `<p>${p}</p>`).join('');

    // 章尾导航
    const end = document.getElementById('readerChapterEnd');
    end.style.display = '';
    const endContent = document.getElementById('readerEndContent');
    if (endContent) {
        endContent.innerHTML = `
            ${idx < total - 1 ? `<p class="chapter-next-label" id="readerNextLabel">第${idx+2}章</p>
            <button class="btn btn-outline btn-sm" id="readerNextBtn" onclick="nextChapter()">继续阅读 →</button>` : '<p class="chapter-next-label">已到最后一章</p>'}
            <div style="margin-top:16px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
                <button class="btn btn-outline btn-sm" onclick="reviseChapterContent('${chapter.id}')">🔧 提建议修改本章</button>
                <button class="btn btn-outline btn-sm" onclick="regenerateChapter('${chapter.id}')">🔄 重新生成本章</button>
            </div>
        `;
    }

    // 滚动到顶部
    document.getElementById('readerContent').scrollTop = 0;
}

function nextChapter() {
    const chapters = Storage.getChapters(currentBookId);
    if (currentChapterIndex < chapters.length - 1) {
        openReader(currentChapterIndex + 1);
    }
}

function prevChapter() {
    if (currentChapterIndex > 0) {
        openReader(currentChapterIndex - 1);
    }
}

function closeReader() {
    document.getElementById('readerScreen').classList.remove('active');
    document.getElementById('bottomBar').style.display = 'none';
    showBookDetail(currentBookId);
}

function toggleReaderMenu() {
    const menu = document.getElementById('readerMenu');
    menu.classList.toggle('open');
    if (menu.classList.contains('open')) {
        const chapters = Storage.getChapters(currentBookId);
        const list = document.getElementById('readerChapterMenu');
        list.innerHTML = chapters.map((ch, i) => `
            <div class="reader-menu-item" onclick="jumpToChapter(${i})">
                ${i === currentChapterIndex ? '● ' : ''}第${i+1}章 ${ch.title||'未命名'}
            </div>
        `).join('');
    }
}

function jumpToChapter(idx) {
    toggleReaderMenu();
    openReader(idx);
}

// 阅读器触摸翻页
let readerTouchStart = { x: 0, y: 0 };
document.addEventListener('DOMContentLoaded', () => {
    const readerScreen = document.getElementById('readerScreen');
    if (!readerScreen) return;
    readerScreen.addEventListener('touchstart', (e) => {
        readerTouchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    });
    readerScreen.addEventListener('touchend', (e) => {
        if (!readerScreen.classList.contains('active')) return;
        const dx = e.changedTouches[0].clientX - readerTouchStart.x;
        const dy = e.changedTouches[0].clientY - readerTouchStart.y;
        if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy)) {
            if (dx < 0) nextChapter();
            else prevChapter();
        }
    });
});

// ===== 章节管理 =====
function showCreateChapterModal() {
    document.getElementById('inputChapterTitle').value = '';
    document.getElementById('inputChapterPrompt').value = '';
    document.getElementById('inputChapterCount').value = '1';
    openSheet('chapterSheet');
}

/** 
 * 生成章节：两步走
 * 1. 立即创建 N 个空壳章节，刷新详情页展示
 * 2. 逐个异步调用 AI 填充内容，实时更新状态
 */
async function generateChapters() {
    const bookId = currentBookId;
    if (!bookId) { showToast('请先选择作品'); return; }

    const chapterCount = parseInt(document.getElementById('inputChapterCount').value) || 1;
    const userTitle = document.getElementById('inputChapterTitle').value.trim();
    const extraPrompt = document.getElementById('inputChapterPrompt').value.trim();

    const book = Storage.getBook(bookId);
    const plans = Storage.getPlans(bookId);
    const existingChapters = Storage.getChapters(bookId);
    const startOrder = existingChapters.length + 1;

    closeSheet('chapterSheet');

    // ====== 第一步：立即创建空壳章节 ======
    const baseTimestamp = Date.now();
    const shellChapters = [];
    for (let i = 0; i < chapterCount; i++) {
        const chOrder = startOrder + i;
        // 使用 Math.random() 加时间戳+索引，确保ID唯一性
        const randomSuffix = Math.random().toString(36).substring(2, 6);
        const shellId = 'ch_' + baseTimestamp + '_' + randomSuffix + '_' + i;
        const shellTitle = (userTitle && chapterCount === 1) ? userTitle : `第${chOrder}章（生成中…）`;
        const shell = {
            id: shellId,
            order: chOrder,
            title: shellTitle,
            content: '',
            status: 'pending', // pending | writing | done | failed
            prompt: extraPrompt || '',
            createdAt: new Date().toISOString()
        };
        shellChapters.push(shell);
        existingChapters.push(shell);
    }
    // ★ P0修复：使用 saveChaptersSync 确保壳章节元数据和 IndexedDB 记录都持久化后再开始 AI 生成
    await Storage.saveChaptersSync(bookId, existingChapters);

    // 刷新详情页展示空壳
    _refreshDetailAfterGenerate(bookId);
    showToast(`已创建 ${chapterCount} 个章节，正在填充内容…`);

    // ====== 第二步：逐个异步填充内容 ======
    let successCount = 0;
    let lastError = '';

    for (let i = 0; i < shellChapters.length; i++) {
        const shell = shellChapters[i];
        const chapterOrder = shell.order;

        // 更新状态为"生成中"
        _updateChapterStatus(bookId, shell.id, { status: 'writing', title: `第${chapterOrder}章 ⏳` });
        _refreshChapterItemInPlace(shell.id, chapterOrder, '⏳ 生成中…', 0);

        try {
            const allChapters = Storage.getChapters(bookId);
            // contextPrompt 聚焦于 System Prompt 中没有的内容：
            // 1. 前文原始结尾（保证场景衔接） 
            // 2. 章节规划（精确到当前章±3章）
            // 注：世界观/大纲/人物/伏笔已在 buildContextMemory 中通过 System Prompt 注入
            let contextPrompt = '';
            contextPrompt += `## 作品信息\n小说《${book?.name || ''}》，类型：${book?.genre || '未分类'}，简介：${book?.desc || '无'}\n\n`;
            
            // 提取当前章对应的章节规划批次（精确提取，不截断）
            if (plans.chapter_plan) {
                const relevantPlan = _extractRelevantChapterPlan(plans.chapter_plan, chapterOrder);
                if (relevantPlan) contextPrompt += `## 章节规划（当前章相关）\n${relevantPlan}\n\n`;
            }

            // 获取前文：只取已成功生成且有内容的章节，排除失败的空壳
            const completedChapters = allChapters.filter(c => 
                c.id !== shell.id && c.content && c.status !== 'failed' && c.status !== 'pending'
            ).sort((a, b) => a.order - b.order);
            
            // 取前3章的结尾（最近1章取1000字，前2章各取500字），保证 AI 知道前文停在哪里
            const recentChapters = completedChapters.slice(-3);
            if (recentChapters.length > 0) {
                contextPrompt += `## 前文章节结尾（确保剧情无缝衔接）\n`;
                recentChapters.forEach((ch, idx) => {
                    const chContent = ch.content || '';
                    // 最近一章取更多内容
                    const takeChars = (idx === recentChapters.length - 1) ? 1000 : 500;
                    const tailStart = Math.max(0, chContent.length - takeChars);
                    const snippet = chContent.substring(tailStart);
                    contextPrompt += `### ${ch.title || '未命名'}（第${ch.order}章）\n...${snippet}\n\n`;
                });
            }
            // 更早前文的简短摘要（前6~前4章开头200字）
            if (completedChapters.length > 3) {
                const earlierChapters = completedChapters.slice(-6, -3);
                if (earlierChapters.length > 0) {
                    contextPrompt += `## 更早前文摘要\n`;
                    earlierChapters.forEach(ch => {
                        const chContent = ch.content || '';
                        const brief = chContent.length > 200 ? chContent.substring(0, 200) + '…' : chContent;
                        contextPrompt += `- 第${ch.order}章《${ch.title || '未命名'}》：${brief.replace(/\n/g, ' ')}\n`;
                    });
                    contextPrompt += '\n';
                }
            }

            let titleHint = '';
            if (userTitle && chapterCount === 1) {
                titleHint = `\n## 指定标题\n${userTitle}\n`;
            } else if (userTitle && i === 0) {
                titleHint = `\n## 参考标题方向\n${userTitle}\n`;
            }

            // ====== Spec 模式：先生成章节规格，再基于规格写正文 ======
            let spec = null;
            try {
                _updateChapterStatus(bookId, shell.id, { status: 'writing', title: `第${chapterOrder}章 📋` });
                _refreshChapterItemInPlace(shell.id, chapterOrder, '📋 规划中…', 0);
                
                spec = await AIService.generateChapterSpec(bookId, chapterOrder);
                // 保存 Spec 供后续参考
                if (spec) Storage.saveChapterSpec(bookId, chapterOrder, spec);
            } catch (specErr) {
                console.warn('Spec 生成失败，降级为直接生成:', specErr.message);
                spec = null;
            }

            // 更新为正文生成状态
            _updateChapterStatus(bookId, shell.id, { status: 'writing', title: `第${chapterOrder}章 ✍️` });
            _refreshChapterItemInPlace(shell.id, chapterOrder, '✍️ 写作中…', 0);

            const contextForAI = Storage.buildContextMemory(bookId, { chapterOrder });
            // System Prompt 已固化（写作原则+输出格式），contextMemory 移到 User Prompt 前缀以利用 DeepSeek 缓存
            const systemPrompt = AIService._getWriterSystemPrompt();

            // 如果有 Spec，用它来精确引导；否则用传统 prompt
            let userPrompt;
            if (spec) {
                userPrompt = `## 创作背景（全书记忆）\n${contextForAI}\n\n${contextPrompt}${titleHint}
## 章节规格（Spec）
${spec}

## 当前任务
请严格按照上述章节规格（Spec）生成第${chapterOrder}章正文。确保：
- before_state 中的角色状态正确延续
- must_happen 中的关键事件全部覆盖
- after_state 的目标状态全部达成
- 章末钩子有力

${extraPrompt ? `\n## 额外提示\n${extraPrompt}\n` : ''}
${i > 0 ? `\n## 连贯性要求\n这是连续生成的第${i + 1}/${chapterCount}章，上一章（第${chapterOrder - 1}章）刚刚生成完毕。请确保本章情节与上一章结尾**无缝衔接**，不能出现时间跳跃、人物位置不一致或情节断层。` : ''}`;
            } else {
                userPrompt = `## 创作背景（全书记忆）\n${contextForAI}\n\n${contextPrompt}${titleHint}
## 当前任务
请生成第${chapterOrder}章正文。

${extraPrompt ? `\n## 额外提示\n${extraPrompt}\n` : ''}
${i > 0 ? `\n## 连贯性要求\n这是连续生成的第${i + 1}/${chapterCount}章，上一章（第${chapterOrder - 1}章）刚刚生成完毕。请确保本章情节与上一章结尾**无缝衔接**，不能出现时间跳跃、人物位置不一致或情节断层。` : ''}`;
            }

            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ];

            const aiResult = await AIService.callAPI(messages, { temperature: 0.85, maxTokens: 8192 });

            if (!aiResult || aiResult.trim().length < 50) {
                _updateChapterStatus(bookId, shell.id, { status: 'failed', title: `第${chapterOrder}章 ❌` });
                _refreshChapterItemInPlace(shell.id, chapterOrder, '❌ 生成失败', 0);
                lastError = 'AI返回内容过短';
                continue;
            }

            const summary = _extractTag(aiResult, '摘要');
            let cleanContent = aiResult
                .replace(/【摘要】[\s\S]*?(?=【|$)/g, '')
                .replace(/【新人物】[\s\S]*?(?=【|$)/g, '')
                .replace(/【新伏笔】[\s\S]*?(?=【|$)/g, '')
                .replace(/【已回收伏笔】[\s\S]*?(?=【|$)/g, '')
                .replace(/【人物关系变化】[\s\S]*?(?=【|$)/g, '')
                .replace(/【世界状态变化】[\s\S]*?(?=【|$)/g, '')
                .trim();


            let chapterTitle = (userTitle && chapterCount === 1) ? userTitle : _generateTitle(cleanContent, chapterOrder);

            // 更新章节为完成状态
            _updateChapterStatus(bookId, shell.id, {
                status: 'done',
                title: chapterTitle,
                content: cleanContent,
                summary: summary || ''
            });
            _refreshChapterItemInPlace(shell.id, chapterOrder, chapterTitle, cleanContent.length);

            // 自动更新持久记忆（使用AI原始输出以保留所有标记信息）
            let memResult = null;
            try {
                memResult = Storage.autoUpdateMemory(bookId, chapterTitle, aiResult, chapterOrder);
            } catch (memErr) {
                console.warn('记忆更新失败:', memErr.message);
            }

            // 如果AI没输出【摘要】，异步用轻量AI补一句话摘要
            if (memResult && memResult.summaryMissing) {
                _generateAISummary(bookId, chapterTitle, cleanContent, chapterOrder).catch(e => 
                    console.warn('AI摘要补充失败:', e.message)
                );
            }

            // 程序化矛盾检测（仅在非首章时执行）
            if (chapterOrder > 1) {
                try {
                    const check = Storage.detectContradictions(bookId, cleanContent, chapterOrder);
                    if (check.hasIssues) {
                        console.warn(`[矛盾检测] 第${chapterOrder}章发现${check.issues.length}个潜在问题:`, 
                            check.issues.map(i => `[${i.severity}] ${i.type}: ${i.detail}`).join('\n'));
                        // P0级别问题在控制台高亮显示
                        const p0Issues = check.issues.filter(i => i.severity === 'P0');
                        if (p0Issues.length > 0) {
                            console.error(`[P0矛盾] 建议人工复核: ${p0Issues.map(i => i.detail).join('; ')}`);
                        }
                    }
                } catch (checkErr) {
                    console.warn('矛盾检测执行失败:', checkErr.message);
                }
            }

            successCount++;

        } catch (e) {
            lastError = e.message || '未知错误';
            _updateChapterStatus(bookId, shell.id, { status: 'failed', title: `第${chapterOrder}章 ❌` });
            _refreshChapterItemInPlace(shell.id, chapterOrder, '❌ 失败', 0);
        }
    }

    // 全部完成后刷新详情页
    _refreshDetailAfterGenerate(bookId);
    if (successCount > 0) {
        showToast(`✨ 成功生成 ${successCount}/${chapterCount} 章`);
    } else {
        showToast('生成失败：' + (lastError || '请检查AI模型配置和网络连接'));
    }
}

/** 更新章节的指定字段（先写 IndexedDB 确保数据持久化，再更新 localStorage 元数据） */
async function _updateChapterStatus(bookId, chapterId, updates) {
    const chapters = Storage.getChapters(bookId);
    const ch = chapters.find(c => c.id === chapterId);
    if (ch) {
        const { content, ...metaUpdates } = updates;
        // ★ 先写入 IndexedDB（正文数据量大，防止丢失）
        if (content !== undefined) {
            try {
                await Storage._indexedDBPutChapter(bookId, chapterId, content);
            } catch (e) {
                console.error('[App] IndexedDB 写入失败，正文可能丢失:', chapterId, e.message);
            }
            ch.content = content; // 保留内存引用
        }
        Object.assign(ch, metaUpdates);
        // ★ 使用同步保存，确保 IndexedDB 写入完成后才继续
        await Storage.saveChaptersSync(bookId, chapters);
    }
}

/** 将单章正文写入 IndexedDB（供内部使用） */
Storage._indexedDBPutChapter = async function(bookId, chapterId, content) {
    try {
        await Storage._chapterDB.updateContent(bookId, chapterId, content);
    } catch (e) {
        console.error('[Storage] IndexedDB 写入单章失败:', e);
    }
};

/** 就地刷新章节列表中的单行（不重绘整个列表） */
function _refreshChapterItemInPlace(chapterId, order, title, wordCount) {
    const titleEl = document.getElementById('chapterTitle_' + chapterId);
    if (titleEl) {
        titleEl.textContent = typeof title === 'string' ? title : (title || '未命名');
    }
    // 更新字数
    const item = titleEl ? titleEl.closest('.chapter-item') : null;
    if (item) {
        const metaEl = item.querySelector('.chapter-item-meta');
        if (metaEl) {
            metaEl.textContent = wordCount > 0 ? `${wordCount} 字` : (typeof title === 'string' && title.includes('⏳') ? '生成中…' : '0 字');
        }
    }
    // 更新序号颜色（完成/失败）
    if (item) {
        const orderEl = item.querySelector('.chapter-item-order');
        if (orderEl) {
            orderEl.classList.remove('status-pending', 'status-writing', 'status-done', 'status-failed');
            if (typeof title === 'string' && title.includes('⏳')) orderEl.classList.add('status-writing');
            else if (typeof title === 'string' && title.includes('❌')) orderEl.classList.add('status-failed');
            else if (wordCount > 0) orderEl.classList.add('status-done');
        }
    }
}

/** 生成完成后刷新详情页（只在全部完成后调用一次） */
function _refreshDetailAfterGenerate(bookId) {
    // 只在详情页 active 时才刷新
    const detailScreen = document.getElementById('detailScreen');
    if (detailScreen && detailScreen.classList.contains('active')) {
        showBookDetail(bookId);
    }
}

/** 从 AI 输出中提取标记内容 */
function _extractTag(text, tagName) {
    const regex = new RegExp(`【${tagName}】\\s*([^【]*)`, '');
    const match = text.match(regex);
    return match ? match[1].trim() : '';
}

/** 从章节规划全文中提取当前章节对应的批次规划 */
function _extractRelevantChapterPlan(planText, chapterOrder) {
    if (!planText) return '';
    
    // 策略：找到包含当前章节号的那段规划内容（前后各扩展几章）
    const lines = planText.split('\n');
    let relevantLines = [];
    let found = false;
    let contextBefore = 0;
    let contextAfter = 0;
    const MAX_BEFORE = 8;  // 当前章前面最多取8行
    const MAX_AFTER = 12;  // 当前章后面最多取12行
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const chMatch = line.match(/第(\d+)章/);
        
        if (chMatch) {
            const chNum = parseInt(chMatch[1]);
            const distance = Math.abs(chNum - chapterOrder);
            
            if (distance <= 3) {
                // 当前章前后3章范围内的规划都纳入
                // 向前回溯几行（取章节标题前的内容）
                let start = i;
                for (let j = i - 1; j >= 0 && i - j < 3; j--) {
                    if (lines[j].match(/第\d+章/)) break; // 遇到上一章就停
                    start = j;
                }
                // 向后取几行
                let end = i + 1;
                for (let k = i + 1; k < lines.length && k - i < 6; k++) {
                    if (lines[k].match(/第\d+章/) && parseInt(lines[k].match(/第(\d+)章/)[1]) > chapterOrder + 3) break;
                    end = k + 1;
                }
                
                for (let j = start; j < end; j++) {
                    if (!relevantLines.includes(j)) {
                        relevantLines.push(j);
                    }
                }
                found = true;
            }
        }
    }
    
    if (!found) {
        // 如果没找到精确匹配，尝试找最近的批次
        // 按章节号排序所有匹配，找最近的
        let closestIdx = -1;
        let closestDist = Infinity;
        for (let i = 0; i < lines.length; i++) {
            const chMatch = lines[i].match(/第(\d+)章/);
            if (chMatch) {
                const dist = Math.abs(parseInt(chMatch[1]) - chapterOrder);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestIdx = i;
                }
            }
        }
        if (closestIdx >= 0) {
            const start = Math.max(0, closestIdx - 5);
            const end = Math.min(lines.length, closestIdx + 20);
            for (let j = start; j < end; j++) relevantLines.push(j);
        }
    }
    
    if (relevantLines.length === 0) {
        // 最终降级：取前800字
        return planText.substring(0, 800);
    }
    
    relevantLines.sort((a, b) => a - b);
    const unique = [...new Set(relevantLines)];
    return unique.map(idx => lines[idx]).join('\n');
}

/** 根据章节内容提取标题存入 chapter.title */
function _generateTitle(content, order) {
    if (!content) return `第${order}章`;
    // 优先匹配 "第X章 标题文本" 格式
    const chapterMatch = content.match(/第[一二三四五六七八九十百千\d]+章[：:\s]*([^\n]{2,30})/);
    if (chapterMatch) return chapterMatch[1].trim().substring(0, 30);
    // 取正文前100字，提取第一句有意义的话
    const snippet = content.substring(0, 100).replace(/\n/g, ' ');
    const keyMatch = snippet.match(/[""]([^""]{2,20})[""]/);
    if (keyMatch) return keyMatch[1].substring(0, 30);
    const cleaned = snippet.replace(/[，。！？、；：""''（）\s]/g, '');
    if (cleaned.length >= 4) return cleaned.substring(0, 30);
    return `第${order}章`;
}

// ===== 章节内容修改 =====

/** 提建议修改章节内容 */
function reviseChapterContent(chapterId) {
    if (!currentBookId) return;
    const chapters = Storage.getChapters(currentBookId);
    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter || !chapter.content) { showToast('该章节暂无内容'); return; }

    // 使用 prompt 弹窗收集修改意见
    const feedback = prompt(
        `请描述对「${chapter.title || '未命名'}」的修改意见：\n（如：对话太生硬、节奏太慢、结尾不够悬念…）`,
        ''
    );
    if (!feedback || !feedback.trim()) return;

    showToast('正在根据建议修改…');
    _doReviseChapter(chapter, feedback.trim());
}

/** 重新生成本章内容 */
function regenerateChapter(chapterId) {
    if (!currentBookId) return;
    const chapters = Storage.getChapters(currentBookId);
    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) return;

    const confirmed = confirm(`确定重新生成「${chapter.title || '未命名'}」？\n当前内容将被替换。`);
    if (!confirmed) return;

    showToast('正在重新生成…');
    _doRegenerateChapter(chapter);
}

async function _doReviseChapter(chapter, feedback) {
    const book = Storage.getBook(currentBookId);
    const plans = Storage.getPlans(currentBookId);

    try {
        const systemPrompt = `你是一位专业小说编辑。用户对章节内容不满意，请根据反馈意见进行修改。
## 修改原则
- 只修改用户指出的问题，保持其他内容不变
- 保持原有的整体结构和风格
- 输出完整修改后的正文（不是只输出修改部分）
- 纯正文输出`;

        const userPrompt = `## 作品信息
小说《${book?.name || ''}》，类型：${book?.genre || '未分类'}

## 当前章节内容
${chapter.content}

## 用户修改意见
${feedback}

请输出修改后的完整正文。`;

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        const aiResult = await AIService.callAPI(messages, { temperature: 0.6, maxTokens: 8192 });

        if (aiResult && aiResult.trim().length > 50) {
            const chapters = Storage.getChapters(currentBookId);
            const target = chapters.find(c => c.id === chapter.id);
            if (target) {
                target.content = aiResult.trim();
                await Storage.saveChaptersSync(currentBookId, chapters);
                // 刷新阅读器
                openReader(currentChapterIndex);
                showToast('🔧 已根据建议修改');
            }
        } else {
            showToast('修改失败：AI返回内容过短');
        }
    } catch (e) {
        showToast('修改失败：' + (e.message || '网络错误'));
    }
}

async function _doRegenerateChapter(chapter) {
    const book = Storage.getBook(currentBookId);
    const plans = Storage.getPlans(currentBookId);
    const allChapters = Storage.getChapters(currentBookId);

    try {
        // ====== Spec 模式：先生成章节规格 ======
        let spec = null;
        try {
            spec = await AIService.generateChapterSpec(currentBookId, chapter.order);
            if (spec) Storage.saveChapterSpec(currentBookId, chapter.order, spec);
        } catch (specErr) {
            console.warn('重新生成Spec失败，降级:', specErr.message);
        }

        let contextPrompt = `## 作品信息\n小说《${book?.name || ''}》，类型：${book?.genre || '未分类'}\n\n`;

        if (plans.chapter_plan) {
            const relevantPlan = _extractRelevantChapterPlan(plans.chapter_plan, chapter.order);
            if (relevantPlan) contextPrompt += `## 章节规划\n${relevantPlan}\n\n`;
        }

        // 前文章节：只取已成功生成且有内容的章节（排除失败空壳）
        const completedPrev = allChapters
            .filter(c => c.order < chapter.order && c.content && c.status !== 'failed' && c.status !== 'pending')
            .sort((a, b) => a.order - b.order);
        
        if (completedPrev.length > 0) {
            // 最近3章的结尾（每章取末尾500字，确保 AI 知道前文停在什么场景）
            const recentPrev = completedPrev.slice(-3);
            contextPrompt += `## 前文章节结尾（确保剧情无缝衔接）\n`;
            recentPrev.forEach(ch => {
                const chContent = ch.content || '';
                const tailStart = Math.max(0, chContent.length - 500);
                const tail = chContent.substring(tailStart);
                contextPrompt += `### 第${ch.order}章《${ch.title || '未命名'}》结尾\n...${tail}\n\n`;
            });
            
            // 更早前文的简短摘要（前6~前4章）
            if (completedPrev.length > 3) {
                const earlierPrev = completedPrev.slice(-6, -3);
                if (earlierPrev.length > 0) {
                    contextPrompt += `## 更早前文摘要\n`;
                    earlierPrev.forEach(ch => {
                        const brief = (ch.content || '').length > 200 
                            ? (ch.content || '').substring(0, 200).replace(/\n/g, ' ') + '…' 
                            : (ch.content || '').replace(/\n/g, ' ');
                        contextPrompt += `- 第${ch.order}章《${ch.title || '未命名'}》：${brief}\n`;
                    });
                    contextPrompt += '\n';
                }
            }
        }

        // 原有提示
        if (chapter.prompt) {
            contextPrompt += `## 创作提示\n${chapter.prompt}\n\n`;
        }

        const systemPrompt = AIService._getWriterSystemPrompt();

        let userPrompt;
        const ctxMemory = Storage.buildContextMemory(currentBookId, { chapterOrder: chapter.order });
        if (spec) {
            userPrompt = `## 创作背景（全书记忆）\n${ctxMemory}\n\n${contextPrompt}## 章节规格\n${spec.substring(0, 1500)}\n\n## 当前任务\n请严格按照章节规格重新生成第${chapter.order}章正文。\n\n## 连贯性强制要求\n- 本章开头必须与**前文最后一章的结尾场景**直接衔接\n- 人物位置、情绪状态必须与前文结尾一致\n- 不能出现时间跳跃或情节断层\n- 如果前文结尾是对话场景，本章应从同一对话场景或紧接的后续动作开始`;
        } else {
            userPrompt = `## 创作背景（全书记忆）\n${ctxMemory}\n\n${contextPrompt}## 当前任务\n请重新生成第${chapter.order}章正文。\n\n## 连贯性强制要求\n- 本章开头必须与**前文最后一章的结尾场景**直接衔接\n- 人物位置、情绪状态必须与前文结尾一致\n- 不能出现时间跳跃或情节断层\n- 如果前文结尾是对话场景，本章应从同一对话场景或紧接的后续动作开始`;
        }

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        const aiResult = await AIService.callAPI(messages, { temperature: 0.85, maxTokens: 8192 });

        if (aiResult && aiResult.trim().length > 50) {
            const cleanContent = aiResult.trim();
            const chapters = Storage.getChapters(currentBookId);
            const target = chapters.find(c => c.id === chapter.id);
            if (target) {
                target.content = cleanContent;
                target.status = 'done'; // 确保状态重置为完成
                // ★ 先持久化到 IndexedDB（正文数据量大，防止丢失）
                await Storage._indexedDBPutChapter(currentBookId, chapter.id, cleanContent);
                // AI 生成 8 字以内概括标题
                try {
                    const titleResult = await AIService.callAPI([
                        { role: 'system', content: '你是一位专业编辑。请根据章节内容生成章节标题。要求：高度概括本章核心内容，不超过8个汉字，直接输出纯文本标题，不要加书名号、引号、冒号、句号等任何标点符号，不要加"第X章"前缀。' },
                        { role: 'user', content: `请为以下章节内容生成标题（不超过8个汉字，不加标点符号）：\n\n${cleanContent.substring(0, 800)}` }
                    ], { temperature: 0.5, maxTokens: 50 });
                    if (titleResult && titleResult.trim()) {
                        // 清洗：去掉所有标点符号和空白
                        let cleanTitle = titleResult.trim()
                            .replace(/[《》""''「」『』【】（）\(\)、，。！？；：\s]/g, '')
                            .substring(0, 30);
                        target.title = cleanTitle || _generateTitle(cleanContent, chapter.order);
                    } else {
                        target.title = _generateTitle(cleanContent, chapter.order);
                    }
                } catch (e) {
                    target.title = _generateTitle(cleanContent, chapter.order);
                }
                await Storage.saveChaptersSync(currentBookId, chapters);

                // 重新生成后刷新记忆：先清除旧记忆，再提取新记忆
                try {
                    Storage._removeChapterFromMemory(currentBookId, chapter);
                    const chapterTitle = target.title || `第${chapter.order}章`;
                    const memResult = Storage.autoUpdateMemory(currentBookId, chapterTitle, aiResult, chapter.order);
                    if (memResult && memResult.summaryMissing) {
                        _generateAISummary(currentBookId, chapterTitle, cleanContent, chapter.order).catch(e =>
                            console.warn('AI摘要补充失败:', e.message)
                        );
                    }
                } catch (memErr) {
                    console.warn('记忆刷新失败:', memErr.message);
                }

                openReader(currentChapterIndex);
                showToast('🔄 章节已重新生成');
            }
        } else {
            showToast('重新生成失败：AI返回内容过短');
        }
    } catch (e) {
        showToast('重新生成失败：' + (e.message || '网络错误'));
    }
}

/** 更新章节标题（支持编辑） */
async function updateChapterTitle(chapterId, newTitle) {
    if (!currentBookId) return;
    const chapters = Storage.getChapters(currentBookId);
    const chapter = chapters.find(ch => ch.id === chapterId);
    if (chapter && newTitle.trim()) {
        chapter.title = newTitle.trim().substring(0, 30);
        // ★ P0修复：使用 saveChaptersSync 确保标题编辑立即持久化，防止刷新丢失
        await Storage.saveChaptersSync(currentBookId, chapters);
        showBookDetail(currentBookId);
        showToast('标题已更新');
    }
}

/** 删除章节 - 第1步：弹出确认框 */
function confirmDeleteChapter(chapterId) {
    if (!currentBookId) return;
    const chapters = Storage.getChapters(currentBookId);
    const chapter = chapters.find(ch => ch.id === chapterId);
    if (!chapter) return;

    // ★ 第1次确认：弹出模态框
    document.getElementById('confirmMessage').textContent = `确定删除「${chapter.title || '未命名'}」？\n此操作不可恢复。`;
    document.getElementById('btnConfirmDelete').onclick = () => {
        closeSheet('confirmSheet');
        // ★ 第2次确认：二次确认弹窗
        setTimeout(() => {
            if (confirm(`再次确认：删除「${chapter.title || '未命名'}」？\n删除后将无法恢复。`)) {
                doDeleteChapter(chapterId);
            }
        }, 300);
    };
    openSheet('confirmSheet');
}

/** 删除章节 - 第2步：执行删除 */
async function doDeleteChapter(chapterId) {
    // ★ P0修复：等待 Storage.deleteChapter 完成 IndexedDB 清理
    await Storage.deleteChapter(currentBookId, chapterId);
    showBookDetail(currentBookId);
    showToast('章节已删除');
}

// ===== 导出作品 =====
function showExportBookModal() {
    const books = Storage.getBooks();
    const select = document.getElementById('exportBookSelect');
    select.innerHTML = books.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    if (currentBookId) select.value = currentBookId;
    openSheet('exportBookSheet');
}

function doExportBook() {
    const select = document.getElementById('exportBookSelect');
    const bookId = select.value;
    const format = document.querySelector('input[name="exportFormat"]:checked')?.value || 'txt';
    const includePlans = document.getElementById('exportIncludePlans')?.checked ?? true;
    closeSheet('exportBookSheet');

    if (typeof DataBackup !== 'undefined') {
        DataBackup.exportBook(bookId, format, { includePlans });
    } else {
        showToast('导出模块未加载');
    }
}

// ===== 数据导出/导入 =====
function exportData() {
    if (typeof DataBackup !== 'undefined') {
        DataBackup.exportData();
    } else {
        showToast('备份模块未加载');
    }
}

function importData() {
    if (typeof DataBackup !== 'undefined') {
        DataBackup.importFromFile();
    } else {
        showToast('备份模块未加载');
    }
}

// ===== 创作规划 =====
function openPlanManager() {
    if (!currentBookId) return;
    if (typeof PlanManager !== 'undefined') {
        PlanManager.open(currentBookId);
    } else {
        showToast('规划模块未加载');
    }
}

// ===== AI 模型管理 =====
function showAddModelModal() {
    renderModelList();
    openSheet('modelSheet');
}

function renderModelList() {
    const list = document.getElementById('modelList');
    const models = Storage.getModels();
    const activeId = Storage.getActiveModelId();

    list.innerHTML = models.length === 0
        ? '<p style="color:var(--text-muted);text-align:center;padding:var(--space-xl)">暂无模型，请添加</p>'
        : models.map(m => `
        <div class="model-item ${m.id === activeId ? 'active-model' : ''}">
            <div class="model-item-info">
                <div class="model-item-name">${m.name||'未命名'}</div>
                <div class="model-item-id">${m.model||''}</div>
            </div>
            <div class="model-item-actions">
                <button class="model-item-btn active-btn" onclick="switchModel('${m.id}')">${m.id===activeId?'当前':'启用'}</button>
                <button class="model-item-btn danger-btn" onclick="deleteModel('${m.id}')">删除</button>
            </div>
        </div>`).join('');
}

function renderModelCount() {
    const models = Storage.getModels();
    document.getElementById('modelCountLabel').textContent = models.length > 0 ? `已配置 ${models.length} 个` : '未配置';
}

function showAddModelForm() {
    document.getElementById('modelAddForm').style.display = '';
    // 重置
    document.getElementById('inputModelProvider').value = '';
    document.getElementById('groupModelUrl').style.display = 'none';
    document.getElementById('inputModelIdCustom').style.display = 'none';
    document.getElementById('inputModelIdSelect').innerHTML = '<option value="">先选择厂商…</option>';
}

// 厂商对应的预设配置
const PROVIDER_CONFIG = {
    deepseek: {
        url: 'https://api.deepseek.com/v1/chat/completions',
        models: [
            { label: 'DeepSeek-V4-Pro（旗舰）', value: 'deepseek-chat' },
            { label: 'DeepSeek-V4-Flash（快速）', value: 'deepseek-chat' },
            { label: 'DeepSeek-R1（深度推理）', value: 'deepseek-reasoner' }
        ]
    },
    openai: {
        url: 'https://api.openai.com/v1/chat/completions',
        models: [
            { label: 'GPT-4o（旗舰）', value: 'gpt-4o' },
            { label: 'GPT-4o Mini（快速）', value: 'gpt-4o-mini' },
            { label: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
            { label: 'o1（推理）', value: 'o1' },
            { label: 'o1 Mini（推理轻量）', value: 'o1-mini' }
        ]
    },
    zhipu: {
        url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        models: [
            { label: 'GLM-4 Plus（旗舰）', value: 'glm-4-plus' },
            { label: 'GLM-4（标准）', value: 'glm-4' },
            { label: 'GLM-4 Flash（快速）', value: 'glm-4-flash' },
            { label: 'GLM-4 Air（轻量）', value: 'glm-4-air' }
        ]
    },
    moonshot: {
        url: 'https://api.moonshot.cn/v1/chat/completions',
        models: [
            { label: 'Kimi（8K）', value: 'moonshot-v1-8k' },
            { label: 'Kimi（32K）', value: 'moonshot-v1-32k' },
            { label: 'Kimi（128K 长文）', value: 'moonshot-v1-128k' }
        ]
    },
    qwen: {
        url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        models: [
            { label: 'Qwen Turbo（快速）', value: 'qwen-turbo' },
            { label: 'Qwen Plus（增强）', value: 'qwen-plus' },
            { label: 'Qwen Max（旗舰）', value: 'qwen-max' },
            { label: 'Qwen Max 长文', value: 'qwen-max-longcontext' }
        ]
    }
};

function onProviderChange() {
    const provider = document.getElementById('inputModelProvider').value;
    const groupUrl = document.getElementById('groupModelUrl');
    const inputUrl = document.getElementById('inputModelUrl');
    const selectId = document.getElementById('inputModelIdSelect');
    const customId = document.getElementById('inputModelIdCustom');

    if (provider === 'custom') {
        // 自定义：显示 URL 输入框和手动 ID 输入
        groupUrl.style.display = '';
        inputUrl.value = '';
        selectId.innerHTML = '<option value="">手动输入…</option>';
        selectId.style.display = 'none';
        customId.style.display = '';
        customId.value = '';
        document.getElementById('inputModelName').value = '';
        return;
    }

    const cfg = PROVIDER_CONFIG[provider];
    if (cfg) {
        // 自动填充 API 地址
        groupUrl.style.display = '';
        inputUrl.value = cfg.url;
        // 填充 model ID 选项
        selectId.style.display = '';
        selectId.innerHTML = cfg.models.map(m => `<option value="${m.value}">${m.label}</option>`).join('');
        selectId.value = cfg.models[0].value;
        customId.style.display = 'none';
        // 自动建议名称
        document.getElementById('inputModelName').value = provider.charAt(0).toUpperCase() + provider.slice(1);
    } else {
        groupUrl.style.display = 'none';
    }
}

function onModelIdChange() {
    // 不需要额外处理，select 的 value 就是 model ID
}

function addModel() {
    const name = document.getElementById('inputModelName').value.trim();
    const key = document.getElementById('inputModelKey').value.trim();
    const url = document.getElementById('inputModelUrl').value.trim();
    const provider = document.getElementById('inputModelProvider').value;
    // 获取 model ID：优先 select，其次手动输入
    const modelSelect = document.getElementById('inputModelIdSelect');
    const modelCustom = document.getElementById('inputModelIdCustom');
    const model = (modelSelect.style.display !== 'none' ? modelSelect.value : modelCustom.value).trim();

    if (!name || !key || !url || !model) { showToast('请填写完整信息'); return; }

    Storage.addModel({ name, apiKey: key, url, model, provider });
    // 重置表单
    document.getElementById('inputModelProvider').value = '';
    document.getElementById('inputModelName').value = '';
    document.getElementById('inputModelKey').value = '';
    document.getElementById('inputModelUrl').value = '';
    document.getElementById('inputModelIdSelect').innerHTML = '<option value="">先选择厂商…</option>';
    document.getElementById('inputModelIdCustom').value = '';
    document.getElementById('inputModelIdCustom').style.display = 'none';
    document.getElementById('inputModelIdSelect').style.display = '';
    document.getElementById('groupModelUrl').style.display = 'none';
    document.getElementById('modelAddForm').style.display = 'none';
    renderModelList();
    renderModelCount();
    showToast('模型已添加');
}

function switchModel(id) {
    Storage.setActiveModelId(id);
    renderModelList();
    renderModelCount();
    showToast('已切换模型');
}

function deleteModel(id) {
    Storage.deleteModel(id);
    renderModelList();
    renderModelCount();
    showToast('模型已删除');
}

// ===== Sheet 弹窗 =====
function openSheet(id) {
    document.getElementById(id).classList.add('open');
    // Sheet 也是子层级，通知原生栈深度+1
    _pushNativeStack();
}
function closeSheet(id) {
    document.getElementById(id).classList.remove('open');
    // Sheet 关闭，栈深度-1
    _popNativeStack();
}

// 点击遮罩关闭
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('sheet-backdrop')) {
        const overlay = e.target.parentElement;
        overlay.classList.remove('open');
        _popNativeStack();
    }
});

// ===== Toast =====
let toastTimer = null;
function showToast(msg, duration = 2000) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ===== 导出 Brainstorm 到全局（供对话回调使用） =====
// Brainstorm.js 中的回调需要能操作 UI，通过全局函数桥接
window._onBrainstormCreateBook = function(bookId) {
    switchTab('bookshelf');
    showToast('作品已创建！');
};

window._onBrainstormMessage = function(role, text) {
    addChatBubble(role, text);
};

// ===== 主题切换 =====
const THEMES = ['warm', 'dark', 'light'];
const THEME_LABELS = { warm: '暖墨', dark: '暗夜', light: '晨曦' };

function _applyTheme() {
    const saved = localStorage.getItem('lingmo_theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    document.getElementById('themeLabel').textContent = THEME_LABELS[saved] || '晨曦';
}

function cycleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'warm';
    const idx = THEMES.indexOf(current);
    const next = THEMES[(idx + 1) % THEMES.length];
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('lingmo_theme', next);
    document.getElementById('themeLabel').textContent = THEME_LABELS[next];
    showToast('已切换为「' + THEME_LABELS[next] + '」主题');
}

// ===== 字体大小 =====
const FONT_SIZES = ['small', 'medium', 'large'];
const FONT_LABELS = { small: '小', medium: '中', large: '大' };

function _applyFontSize() {
    const saved = localStorage.getItem('lingmo_font_size') || 'medium';
    document.documentElement.setAttribute('data-font-size', saved);
    document.getElementById('fontSizeLabel').textContent = FONT_LABELS[saved] || '中';
}

function cycleFontSize() {
    const current = document.documentElement.getAttribute('data-font-size') || 'medium';
    const idx = FONT_SIZES.indexOf(current);
    const next = FONT_SIZES[(idx + 1) % FONT_SIZES.length];
    document.documentElement.setAttribute('data-font-size', next);
    localStorage.setItem('lingmo_font_size', next);
    document.getElementById('fontSizeLabel').textContent = FONT_LABELS[next];
    showToast('字体大小：' + FONT_LABELS[next]);
}

/**
 * 异步生成章节的AI一句话摘要（极轻量，~200 tokens）
 * 当 AI 正文输出遗漏【摘要】标记时，用此函数补上
 */
async function _generateAISummary(bookId, chapterTitle, cleanContent, chapterOrder) {
    if (!cleanContent || cleanContent.length < 100) return;
    
    try {
        const sys = '你是一位编辑。请根据章节内容生成一句话摘要（50字以内），必须包含核心事件和关键人物状态变化。直接输出纯文本摘要，不要加任何标记或解释。';
        const user = `章节内容（前800字）：\n${cleanContent.substring(0, 800)}\n\n请输出一句话摘要：`;
        
        const result = await AIService.callAPI(
            [{ role: 'system', content: sys }, { role: 'user', content: user }],
            { temperature: 0.3, maxTokens: 100 }
        );
        
        if (result && result.trim()) {
            const summary = result.trim().substring(0, 80);
            // 使用队列更新记忆，防止竞态覆盖
            await Storage._enqueueSummaryUpdate(bookId, (memory) => {
                // 优先用 chapterOrder 精确匹配，title 仅作降级
                let chapter = memory.chapterSummaries.find(s => s.chapterNum === chapterOrder);
                if (!chapter) {
                    chapter = memory.chapterSummaries.find(s => s.title === chapterTitle);
                }
                if (chapter) {
                    chapter.summary = summary;
                }
            });
        }
    } catch (e) {
        // 静默失败，不影响主流程
        console.warn('AI摘要生成失败:', e.message);
    }
}

// ===== 清空数据 =====
async function clearAllData() {
    document.getElementById('confirmMessage').textContent = '确定清空所有数据？包括全部作品、章节、模型配置。此操作不可恢复！';
    document.getElementById('btnConfirmDelete').onclick = async () => {
        // 先收集所有需要清理 IndexedDB 的 bookId
        let bookIds = [];
        try {
            const books = JSON.parse(localStorage.getItem('books') || '[]');
            bookIds = books.map(b => b.id);
        } catch {}

        // 清理所有书的 IndexedDB 章节数据
        for (const bookId of bookIds) {
            try {
                await Storage._chapterDB.deleteBook(bookId);
            } catch (e) {
                console.warn('[App] 清理 IndexedDB 失败:', bookId, e.message);
            }
        }

        // 清理 localStorage（只清除灵墨应用数据，保留主题/字体等用户偏好）
        const lingmoPrefixes = [
            'books', 'chapters_', 'memory_', 'plans_', 'specs_',
            'reviews_', 'ai_models', 'active_model_id', 'bs_',
            'creation_state_', 'guide_answers_', 'guide_state_'
        ];
        // 先收集需要删除的所有 key（避免遍历过程中修改 localStorage）
        const keysToDelete = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            // 保留非灵墨 key（如主题 lingmo_theme、字体 lingmo_font_size）
            if (key.startsWith('lingmo_')) continue;
            if (key === 'version') continue;
            // 检查是否匹配灵墨前缀
            const isLingmo = lingmoPrefixes.some(prefix => key === prefix || key.startsWith(prefix));
            if (isLingmo) keysToDelete.push(key);
        }
        keysToDelete.forEach(key => localStorage.removeItem(key));

        closeSheet('confirmSheet');
        showToast('数据已清空');
        renderBookshelf();
        renderModelList();
        renderModelCount();
        switchTab('chat');
    };
    openSheet('confirmSheet');
}
