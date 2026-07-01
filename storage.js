/**
 * 本地存储管理模块
 * 混合存储架构：localStorage（元数据/记忆） + IndexedDB（章节正文）
 * 
 * 原因：localStorage 有 5-10MB 上限，500章正文会溢出
 * IndexedDB 可存储数百MB，且支持索引查询
 * 
 * 数据安全：每次写操作后自动触发文件级备份
 * 备份文件存储在应用私有文档目录和下载目录
 * 更新/覆盖安装APK后，启动时自动从备份文件恢复数据
 */


// ===== IndexedDB 适配层（用于存储章节正文，突破 5MB 限制） =====
const ChapterDB = (() => {
    const DB_NAME = 'lingmo_chapters';
    const DB_VERSION = 1;
    let _db = null;

    function _openDB() {
        if (_db) return Promise.resolve(_db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('chapters')) {
                    db.createObjectStore('chapters', { keyPath: 'id' }); // id = `${bookId}_${chapterId}`
                }
                if (!db.objectStoreNames.contains('chapterIndex')) {
                    const idxStore = db.createObjectStore('chapterIndex', { keyPath: 'bookId' });
                    idxStore.createIndex('bookId', 'bookId', { unique: true });
                }
            };
            req.onsuccess = (e) => {
                _db = e.target.result;
                resolve(_db);
            };
            req.onerror = () => reject(req.error);
        });
    }

    /** 
     * 保存全部章节正文到 IndexedDB（一次事务写入，带超时保护）
     * 
     * ★ P0修复（章节内容丢失）：之前 idxReq.onsuccess 回调在事务内异步触发，
     * 可能在 store.put() 之后执行，导致刚写入的章节内容被 delete 删除。
     * 
     * 修复：在事务外先读取旧索引确定孤儿记录，事务内按 删除孤儿→写入新数据→更新索引 顺序同步执行。
     */
    async function saveAll(bookId, chapters) {
        try {
            const db = await _openDB();

            // ★ 步骤0：事务外读取旧索引，确定需要清理的孤儿记录
            const newChapterIds = new Set(chapters.map(ch => `${bookId}_${ch.id}`));
            const orphanIds = [];
            try {
                const oldIndex = await new Promise((resolve) => {
                    const tx = db.transaction(['chapterIndex'], 'readonly');
                    const req = tx.objectStore('chapterIndex').get(bookId);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => resolve(null);
                });
                if (oldIndex && oldIndex.chapterIds) {
                    orphanIds.push(...oldIndex.chapterIds.filter(cid => !newChapterIds.has(cid)));
                }
            } catch { /* 首次运行，索引不存在 */ }

            const TX_TIMEOUT_MS = 30000;
            return new Promise((resolve) => {
                let settled = false;
                const done = (result) => {
                    if (!settled) { settled = true; resolve(result); }
                };

                const timeoutId = setTimeout(() => {
                    console.warn('[ChapterDB] 事务超时 (30s)，强制返回');
                    done(false);
                }, TX_TIMEOUT_MS);

                const tx = db.transaction(['chapters', 'chapterIndex'], 'readwrite');
                const store = tx.objectStore('chapters');
                const idxStore = tx.objectStore('chapterIndex');

                // ★ 步骤1：同步删除孤儿记录（不依赖异步回调）
                orphanIds.forEach(cid => store.delete(cid));

                // ★ 步骤2：写入新数据
                const chapterIds = [];
                chapters.forEach(ch => {
                    const dbId = `${bookId}_${ch.id}`;
                    chapterIds.push(dbId);
                    store.put({ id: dbId, content: ch.content || '' });
                });

                // ★ 步骤3：更新索引
                idxStore.put({ bookId, chapterIds, updatedAt: new Date().toISOString() });

                tx.oncomplete = () => { clearTimeout(timeoutId); done(true); };
                tx.onerror = () => {
                    clearTimeout(timeoutId);
                    console.error('[ChapterDB] 事务失败:', tx.error);
                    done(false);
                };
            });
        } catch (e) {
            console.error('[ChapterDB] saveAll 失败:', e);
            return false;
        }
    }

    /** 获取单章正文 */
    async function getContent(bookId, chapterId) {
        try {
            const db = await _openDB();
            return new Promise((resolve) => {
                const tx = db.transaction('chapters', 'readonly');
                const store = tx.objectStore('chapters');
                const req = store.get(`${bookId}_${chapterId}`);
                req.onsuccess = () => resolve(req.result?.content || '');
                req.onerror = () => resolve('');
            });
        } catch { return ''; }
    }

    /** 更新单章正文 */
    async function updateContent(bookId, chapterId, content) {
        try {
            const db = await _openDB();
            return new Promise((resolve) => {
                const tx = db.transaction(['chapters', 'chapterIndex'], 'readwrite');
                const store = tx.objectStore('chapters');
                store.put({ id: `${bookId}_${chapterId}`, content });

                // 更新索引（追加新章节ID）
                const idxStore = tx.objectStore('chapterIndex');
                const req = idxStore.get(bookId);
                req.onsuccess = () => {
                    const entry = req.result || { bookId, chapterIds: [] };
                    const dbId = `${bookId}_${chapterId}`;
                    if (!entry.chapterIds.includes(dbId)) entry.chapterIds.push(dbId);
                    entry.updatedAt = new Date().toISOString();
                    idxStore.put(entry);
                };

                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch { return false; }
    }

    /** 删除单章正文 */
    async function deleteContent(bookId, chapterId) {
        try {
            const db = await _openDB();
            return new Promise((resolve) => {
                const tx = db.transaction(['chapters', 'chapterIndex'], 'readwrite');
                const store = tx.objectStore('chapters');
                store.delete(`${bookId}_${chapterId}`);

                const idxStore = tx.objectStore('chapterIndex');
                const req = idxStore.get(bookId);
                req.onsuccess = () => {
                    if (req.result) {
                        const entry = req.result;
                        entry.chapterIds = entry.chapterIds.filter(id => id !== `${bookId}_${chapterId}`);
                        entry.updatedAt = new Date().toISOString();
                        idxStore.put(entry);
                    }
                };

                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch { return false; }
    }

    /** 删除整本书的章节正文 */
    async function deleteBook(bookId) {
        try {
            const db = await _openDB();
            return new Promise((resolve) => {
                const tx = db.transaction(['chapters', 'chapterIndex'], 'readwrite');
                const idxStore = tx.objectStore('chapterIndex');
                const req = idxStore.get(bookId);
                req.onsuccess = () => {
                    if (req.result) {
                        const store = tx.objectStore('chapters');
                        req.result.chapterIds.forEach(cid => store.delete(cid));
                        idxStore.delete(bookId);
                    }
                };
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch { return false; }
    }

    return { saveAll, getContent, updateContent, deleteContent, deleteBook };
})();


const Storage = {
    // ============ 摘要写入队列（防止异步竞态覆盖） ============
    _summaryQueue: Promise.resolve(),

    // ============ 自动备份（防抖，每次写操作后触发） ============
    _backupDebounceTimer: null,
    _backupDebounceMs: 5000, // 5秒防抖，避免频繁备份

    /** 触发自动备份（防抖），在核心写操作后调用 */
    _triggerAutoBackup() {
        if (typeof DataBackup === 'undefined') return;
        // 只在原生环境执行文件级备份，Web环境跳过（数据在浏览器缓存中）
        if (!DataBackup.isNative || !DataBackup.isNative()) return;

        if (this._backupDebounceTimer) clearTimeout(this._backupDebounceTimer);
        this._backupDebounceTimer = setTimeout(() => {
            try {
                const backup = DataBackup.collectAllData();
                const jsonStr = JSON.stringify(backup);
                const MAX_BACKUP_SIZE = 10 * 1024 * 1024; // 10MB 上限
                if (jsonStr.length > MAX_BACKUP_SIZE) {
                    console.warn(`[Storage] 备份数据过大 (${(jsonStr.length / 1024 / 1024).toFixed(1)}MB)，跳过自动备份`);
                    return;
                }
                // 使用 Capacitor Filesystem 直接写入（非分享模式，静默写入）
                DataBackup._silentWriteBackup(jsonStr);
            } catch (e) {
                console.warn('[Storage] 自动备份失败:', e.message);
            }
        }, this._backupDebounceMs);
    },

    /**
     * 安全地更新某章节的摘要（入队执行，保证顺序）
     * @param {Function} updater - 接收 memory，修改后返回 memory
     */
    async _enqueueSummaryUpdate(bookId, updater) {
        this._summaryQueue = this._summaryQueue.then(async () => {
            const memory = this.getMemory(bookId);
            updater(memory);
            this.saveMemory(bookId, memory);
        }).catch(e => {
            console.error('[Storage] 摘要队列写入失败:', e);
        });
        return this._summaryQueue;
    },

    // ============ 存储安全层 ============
    /**
     * 安全写入 localStorage，带容量检测和错误恢复
     * 返回 { success, error? }
     */
    _safeSetItem(key, value) {
        try {
            localStorage.setItem(key, value);
            return { success: true };
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.toString().includes('quota')) {
                console.error(`[Storage] localStorage 容量不足！key=${key}，数据大小≈${(value.length / 1024).toFixed(1)}KB`);
                // 尝试清理旧备份数据腾出空间
                this._emergencyCleanup();
                try {
                    localStorage.setItem(key, value);
                    return { success: true };
                } catch (e2) {
                    return { success: false, error: 'STORAGE_FULL' };
                }
            }
            return { success: false, error: e.message };
        }
    },

    /**
     * 紧急清理：删除非关键旧数据，返回是否释放了空间
     */
    _emergencyCleanup() {
        let freedCount = 0;
        try {
            const keys = Object.keys(localStorage);
            // 删除所有评审记录（可重新生成）
            keys.forEach(k => {
                if (k.startsWith('reviews_')) {
                    localStorage.removeItem(k);
                    freedCount++;
                }
            });
            // 如果没有评审记录可清理，尝试清理旧的 specs 数据
            if (freedCount === 0) {
                keys.forEach(k => {
                    if (k.startsWith('specs_')) {
                        localStorage.removeItem(k);
                        freedCount++;
                    }
                });
            }
            if (freedCount > 0) {
                console.warn(`[Storage] 已执行紧急清理（释放了 ${freedCount} 项数据）`);
            }
        } catch {}
        return freedCount;
    },

    /**
     * 获取当前 localStorage 使用量估算（字节）
     */
    getStorageUsage() {
        let total = 0;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                total += key.length + (localStorage.getItem(key)?.length || 0);
            }
        } catch {}
        return total;
    },

    // ============ 模型配置 ============
    getModels() {
        try {
            return JSON.parse(localStorage.getItem('ai_models') || '[]');
        } catch { return []; }
    },

    saveModels(models) {
        this._safeSetItem('ai_models', JSON.stringify(models));
        this._triggerAutoBackup();
    },

    addModel(model) {
        const models = this.getModels();
        model.id = 'model_' + Date.now();
        models.push(model);
        this.saveModels(models);
        if (models.length === 1) {
            this.setActiveModelId(model.id);
        }
        return model;
    },

    deleteModel(id) {
        const models = this.getModels().filter(m => m.id !== id);
        this.saveModels(models);
        if (this.getActiveModelId() === id) {
            this.setActiveModelId(models.length > 0 ? models[0].id : null);
        }
    },

    getActiveModelId() {
        return localStorage.getItem('active_model_id') || null;
    },

    setActiveModelId(id) {
        this._safeSetItem('active_model_id', id);
    },

    getActiveModel() {
        const models = this.getModels();
        const activeId = this.getActiveModelId();
        return models.find(m => m.id === activeId) || models[0] || null;
    },

    // ============ 书籍管理 ============
    getBooks() {
        try {
            return JSON.parse(localStorage.getItem('books') || '[]');
        } catch { return []; }
    },

    saveBooks(books) {
        this._safeSetItem('books', JSON.stringify(books));
        this._triggerAutoBackup();
    },

    getBook(id) {
        return this.getBooks().find(b => b.id === id) || null;
    },

    addBook(book) {
        const books = this.getBooks();
        book.id = 'book_' + Date.now();
        book.createdAt = new Date().toISOString();
        book.updatedAt = new Date().toISOString();
        books.unshift(book);
        this.saveBooks(books);
        return book;
    },

    updateBook(id, updates) {
        const books = this.getBooks();
        const idx = books.findIndex(b => b.id === id);
        if (idx >= 0) {
            books[idx] = { ...books[idx], ...updates, updatedAt: new Date().toISOString() };
            this.saveBooks(books);
            return books[idx];
        }
        return null;
    },

    deleteBook(id) {
        const books = this.getBooks().filter(b => b.id !== id);
        this.saveBooks(books);
        // 同时删除该书的记忆和章节
        localStorage.removeItem(`memory_${id}`);
        localStorage.removeItem(`chapters_${id}`);
        localStorage.removeItem(`plans_${id}`);
        localStorage.removeItem(`specs_${id}`);
        localStorage.removeItem(`reviews_${id}`);
        // 异步清理 IndexedDB
        ChapterDB.deleteBook(id).catch(e => {
            console.error('[Storage] IndexedDB 删除书本章节失败:', e);
        });
    },

    // ============ 章节管理（元数据在 localStorage，正文在 IndexedDB） ============
    getChapters(bookId) {
        try {
            const chapters = JSON.parse(localStorage.getItem(`chapters_${bookId}`) || '[]');
            // 从 IndexedDB 加载正文（异步，此处同步返回时正文为空）
            // 调用方应在渲染前调用 loadChapterContents()
            return chapters;
        } catch { return []; }
    },

    /**
     * 批量加载章节正文（从 IndexedDB 异步填充到章节对象的 content 字段）
     * @returns {Promise<Array>} 填充了正文的章节数组
     */
    async loadChapterContents(bookId, chapters) {
        const chs = chapters || this.getChapters(bookId);
        await Promise.all(chs.map(async (ch) => {
            if (!ch.content || ch.content === '') {
                ch.content = await ChapterDB.getContent(bookId, ch.id);
            }
        }));
        return chs;
    },

    /**
     * 加载单章正文
     */
    async loadChapterContent(bookId, chapterId) {
        return ChapterDB.getContent(bookId, chapterId);
    },

    /**
     * 保存章节列表（元数据存 localStorage，正文存 IndexedDB）
     */
    saveChapters(bookId, chapters) {
        // 1. localStorage 存元数据（不含 content 字段，节省空间）
        const metaChapters = chapters.map(ch => {
            const { content, ...meta } = ch;
            return { ...meta, _hasContent: !!content };
        });
        const result = this._safeSetItem(`chapters_${bookId}`, JSON.stringify(metaChapters));
        if (!result.success) {
            console.error(`[Storage] 保存章节元数据失败: bookId=${bookId}, error=${result.error}`);
            if (typeof window !== 'undefined' && window.dispatchEvent) {
                window.dispatchEvent(new CustomEvent('storage-error', {
                    detail: { type: 'chapters_meta', bookId, error: result.error }
                }));
            }
        }
        // 2. IndexedDB 存正文（异步，不阻塞主流程）
        ChapterDB.saveAll(bookId, chapters).catch(e => {
            console.error('[Storage] IndexedDB 保存章节正文失败:', e);
        });
        this._triggerAutoBackup();
        return result.success;
    },

    /**
     * 同步保存章节（等待 IndexedDB 写入完成）
     * 用于关键路径（如章节生成完成后必须确保持久化）
     */
    async saveChaptersSync(bookId, chapters) {
        const metaChapters = chapters.map(ch => {
            const { content, ...meta } = ch;
            return { ...meta, _hasContent: !!content };
        });
        this._safeSetItem(`chapters_${bookId}`, JSON.stringify(metaChapters));
        await ChapterDB.saveAll(bookId, chapters);
    },

    getChapter(bookId, chapterId) {
        const chapters = this.getChapters(bookId);
        return chapters.find(c => c.id === chapterId) || null;
    },

    addChapter(bookId, chapter) {
        const chapters = this.getChapters(bookId);
        chapter.id = 'ch_' + Date.now();
        chapter.order = chapters.length + 1;
        chapter.createdAt = new Date().toISOString();
        chapter.updatedAt = new Date().toISOString();
        chapters.push(chapter);
        this.saveChapters(bookId, chapters);
        return chapter;
    },

    /**
     * 同步添加章节（等待 IndexedDB 写入完成）
     */
    async addChapterSync(bookId, chapter) {
        const chapters = this.getChapters(bookId);
        chapter.id = 'ch_' + Date.now();
        chapter.order = chapters.length + 1;
        chapter.createdAt = new Date().toISOString();
        chapter.updatedAt = new Date().toISOString();
        chapters.push(chapter);
        await this.saveChaptersSync(bookId, chapters);
        return chapter;
    },

    updateChapter(bookId, chapterId, updates) {
        const chapters = this.getChapters(bookId);
        const idx = chapters.findIndex(c => c.id === chapterId);
        if (idx >= 0) {
            // 如果有正文更新，同步写入 IndexedDB
            if (updates.content !== undefined) {
                ChapterDB.updateContent(bookId, chapterId, updates.content).catch(e => {
                    console.error('[Storage] IndexedDB 更新章节正文失败:', e);
                });
            }
            const { content, ...metaUpdates } = updates;
            chapters[idx] = { ...chapters[idx], ...metaUpdates, _hasContent: !!chapters[idx].content || !!content, updatedAt: new Date().toISOString() };
            this.saveChapters(bookId, chapters);
            // 恢复 content 引用（内存中保留正文）
            if (content !== undefined) chapters[idx].content = content;
            return chapters[idx];
        }
        return null;
    },

    /**
     * 删除章节
     * P0修复：改用 saveChaptersSync 确保删除操作完整持久化；
     * deleteContent 作为双重保险，在 saveAll 之后显式删除被删章节的 IndexedDB 记录。
     */
    async deleteChapter(bookId, chapterId) {
        const allChapters = this.getChapters(bookId);
        const deletedChapter = allChapters.find(c => c.id === chapterId);
        const chapters = allChapters.filter(c => c.id !== chapterId);
        // 重新排序
        chapters.forEach((c, i) => c.order = i + 1);
        // ★ P0修复：使用同步保存，确保 localStorage 元数据和 IndexedDB 都完成写入
        await this.saveChaptersSync(bookId, chapters);
        // 双重保险：显式清理被删章节的 IndexedDB 正文记录
        try {
            await ChapterDB.deleteContent(bookId, chapterId);
        } catch (e) {
            console.error('[Storage] IndexedDB 删除章节正文失败:', e);
        }
        // 同步清理记忆中与该章节关联的数据
        if (deletedChapter) {
            this._removeChapterFromMemory(bookId, deletedChapter);
        }
    },

    /**
     * 从记忆中移除指定章节的所有关联数据
     * 用于删除章节或重新生成时清理旧记忆
     */
    _removeChapterFromMemory(bookId, deletedChapter) {
        if (!deletedChapter) return;

        const memory = this.getMemory(bookId);
        const chapterTitle = deletedChapter.title || '';
        const chapterOrder = deletedChapter.order;

        // 移除章节摘要
        memory.chapterSummaries = memory.chapterSummaries.filter(s => {
            return s.chapterNum !== chapterOrder;
        });

        // 移除因果链中该章节的条目
        if (memory.causalChain) {
            memory.causalChain = memory.causalChain.filter(c => c.chapter !== chapterTitle);
        }

        this.saveMemory(bookId, memory);
    },

    // ============ 书籍记忆系统（独立存储，不共享） ============
    /**
     * 获取某本书的完整记忆
     * 记忆结构: { summary, characters[], plotHooks[], keyEvents[], worldState{}, chapterSummaries[], characterRelations{}, hookResolved{}, causalChain[] }
     */
    getMemory(bookId) {
        try {
            const mem = JSON.parse(localStorage.getItem(`memory_${bookId}`) || 'null');
            // 兼容旧数据结构，补齐新字段
            return {
                summary: mem?.summary || '',
                characters: mem?.characters || [],
                plotHooks: mem?.plotHooks || [],
                keyEvents: mem?.keyEvents || [],
                worldState: mem?.worldState || {},
                chapterSummaries: mem?.chapterSummaries || [],
                characterRelations: mem?.characterRelations || {},
                hookResolved: mem?.hookResolved || {},
                causalChain: mem?.causalChain || []
            };
        } catch {
            return {
                summary: '', characters: [], plotHooks: [], keyEvents: [],
                worldState: {}, chapterSummaries: [], characterRelations: {},
                hookResolved: {}, causalChain: []
            };
        }
    },

    saveMemory(bookId, memory) {
        const result = this._safeSetItem(`memory_${bookId}`, JSON.stringify(memory));
        if (!result.success) {
            console.error(`[Storage] 保存记忆失败: bookId=${bookId}, error=${result.error}`);
            // 触发 UI 通知（通过全局事件）
            if (typeof window !== 'undefined' && window.dispatchEvent) {
                window.dispatchEvent(new CustomEvent('storage-error', {
                    detail: { type: 'memory', bookId, error: result.error }
                }));
            }
        }
        this._triggerAutoBackup();
        return result.success;
    },

    /**
     * 更新书籍记忆 - 添加章节摘要（全部保留，不截断）
     * 新增：角色关系更新、世界状态更新、因果链追加
     */
    addChapterMemory(bookId, chapterTitle, summary, newCharacters, newPlotHooks, keyEvents, extra = {}) {
        const memory = this.getMemory(bookId);
        const chapterNum = parseInt(chapterTitle.match(/\d+/)?.[0] || '0');
        
        // 添加章节摘要（全部保留）
        memory.chapterSummaries.push({
            title: chapterTitle,
            summary: summary,
            chapterNum: chapterNum,
            timestamp: new Date().toISOString()
        });

        // 合并新人物（去重，全部保留）+ 追加状态变更历史
        if (newCharacters && newCharacters.length > 0) {
            newCharacters.forEach(c => {
                const existing = memory.characters.find(mc => mc.name === c.name);
                if (!existing) {
                    memory.characters.push({
                        name: c.name,
                        description: c.description || '',
                        status: c.status || '活跃',
                        firstAppear: chapterTitle,
                        statusHistory: [{ chapter: chapterTitle, status: c.status || '活跃' }]
                    });
                } else {
                    // 更新已有角色的状态，并记录历史（最多保留20条）
                    if (c.status && c.status !== existing.status) {
                        if (!existing.statusHistory) existing.statusHistory = [];
                        existing.statusHistory.push({ chapter: chapterTitle, status: c.status, prev: existing.status });
                        if (existing.statusHistory.length > 20) {
                            // 保留最早1条 + 最近19条
                            existing.statusHistory = [existing.statusHistory[0], ...existing.statusHistory.slice(-19)];
                        }
                        existing.status = c.status;
                    }
                    if (c.description) existing.description = c.description;
                    // 更新角色最后出现章节
                    existing.lastAppear = chapterTitle;
                }
            });
        }

        // 合并角色关系
        if (extra.relations) {
            if (!memory.characterRelations) memory.characterRelations = {};
            Object.keys(extra.relations).forEach(pairKey => {
                const rel = extra.relations[pairKey];
                if (!memory.characterRelations[pairKey]) {
                    memory.characterRelations[pairKey] = {
                        type: rel.type,
                        established: chapterTitle,
                        history: [{ chapter: chapterTitle, change: rel.type }]
                    };
                } else {
                    const existing = memory.characterRelations[pairKey];
                    if (rel.type && rel.type !== existing.type) {
                        if (!existing.history) existing.history = [];
                        existing.history.push({ chapter: chapterTitle, change: rel.type, prev: existing.type });
                        if (existing.history.length > 15) {
                            // 保留最早1条 + 最近14条
                            existing.history = [existing.history[0], ...existing.history.slice(-14)];
                        }
                        existing.type = rel.type;
                    }
                }
            });
        }

        // 合并世界状态变化
        if (extra.worldChanges) {
            if (!memory.worldState) memory.worldState = {};
            Object.keys(extra.worldChanges).forEach(k => {
                const oldVal = memory.worldState[k];
                memory.worldState[k] = {
                    value: extra.worldChanges[k],
                    updatedAt: chapterTitle,
                    previousValue: oldVal?.value
                };
            });
        }

        // 合并新伏笔（去重，支持标记是否回收）
        if (newPlotHooks && newPlotHooks.length > 0) {
            newPlotHooks.forEach(h => {
                const hookText = typeof h === 'string' ? h : h.description || '';
                if (hookText && !memory.plotHooks.find(ph => (ph.description || ph) === hookText)) {
                    memory.plotHooks.push({
                        description: hookText,
                        plantedChapter: chapterTitle,
                        resolved: false,
                        resolvedChapter: null
                    });
                }
            });
        }

        // 处理伏笔回收
        if (extra.resolvedHooks && extra.resolvedHooks.length > 0) {
            if (!memory.hookResolved) memory.hookResolved = {};
            extra.resolvedHooks.forEach(hookDesc => {
                memory.hookResolved[hookDesc] = chapterTitle;
                // 标记对应伏笔为已回收
                const hook = memory.plotHooks.find(ph => 
                    (ph.description || ph) === hookDesc
                );
                if (hook && !hook.resolved) {
                    hook.resolved = true;
                    hook.resolvedChapter = chapterTitle;
                }
            });
        }

        // 追加因果链（最多保留80条，超出时合并早期条目并保留因果元数据）
        if (extra.causalEvent) {
            if (!memory.causalChain) memory.causalChain = [];
            memory.causalChain.push({
                chapter: chapterTitle,
                event: extra.causalEvent,
                cause: (extra.cause || '').substring(0, 40),
                effect: (extra.effect || '').substring(0, 40)
            });
            // 超过80条时，把前10条合并为一条摘要（保留cause/effect）
            if (memory.causalChain.length > 80) {
                const slice = memory.causalChain.slice(0, 10);
                const mergedEvent = slice.map(c => c.event).join(' → ');
                // 保留首条的 cause 和末条的 effect
                const firstCause = slice[0].cause || '';
                const lastEffect = slice[slice.length - 1].effect || '';
                const chapterRange = `${slice[0].chapter}-${slice[slice.length - 1].chapter}`;
                memory.causalChain = [
                    {
                        chapter: chapterRange,
                        event: '【因果链摘要】' + mergedEvent,
                        cause: firstCause ? `起因：${firstCause}` : '',
                        effect: lastEffect ? `结果：${lastEffect}` : ''
                    },
                    ...memory.causalChain.slice(10)
                ];
            }
        }

        // 合并关键事件（全部保留，去重）
        if (keyEvents && keyEvents.length > 0) {
            keyEvents.forEach(e => {
                if (!memory.keyEvents.includes(e)) {
                    memory.keyEvents.push(e);
                }
            });
        }

        this.saveMemory(bookId, memory);
        return memory;
    },

    /**
     * 构建用于 AI 的上下文记忆字符串（完整版，用于 User Prompt 前缀）
     * 
     * 由于 System Prompt 已固化（利用 DeepSeek 前缀缓存），
     * contextMemory 放在 User Prompt 中，不受缓存破坏影响。
     * 因此不再严格限制 token，保留更完整的信息。
     * 
     * 内容结构：
     * - 书籍信息 + 进度
     * - 人物（全量 + 关系网络）
     * - 因果链（全量，超过60条时早期合并）
     * - 章节摘要（近期完整 + 前中期按关键词筛选）
     * - 伏笔（区分已回收/未回收）
     * - 世界状态
     * - 关键事件时间线
     */
    /**
     * 构建全书记忆上下文。
     * 
     * 拼接顺序已优化为「不变部分在前 + 可变部分在后」，
     * 以最大化 DeepSeek 等 LLM 的前缀缓存命中率。
     * 
     * 不变部分（阶段内生成时内容固定）：
     *   书名/类型/简介 → 世界观设定 → 大纲 → 人物 → 世界状态
     * 可变部分（每章变化）：
     *   全书进度 → 因果链 → 章节摘要 → 伏笔追踪 → 关键事件时间线
     */
    buildContextMemory(bookId, extraOptions = {}) {
        const memory = this.getMemory(bookId);
        const book = this.getBook(bookId);
        const plans = this.getPlans(bookId);
        const { chapterOrder = 0 } = extraOptions;
        const totalChapters = memory.chapterSummaries.length;

        // ================================================================
        // 第一部分：不变信息（最大化缓存命中）
        // ================================================================
        let context = '';

        // 1. 书籍基本信息
        if (book) {
            context += `【书名】${book.name}\n`;
            context += `【类型】${book.genre}\n`;
            if (book.desc) context += `【简介】${book.desc}\n`;
        }

        // 2. 世界观设定
        if (plans.setting) {
            context += `\n【世界观设定】\n${plans.setting}\n`;
        }

        // 3. 大纲（智能提取当前阶段 + 全局模块）
        if (plans.outline) {
            if (chapterOrder > 0 && plans.outline.length > 800) {
                const stageContext = this._extractStageContext(plans.outline, chapterOrder);
                context += `\n【大纲】\n${stageContext}\n`;
            } else {
                context += `\n【大纲】\n${plans.outline}\n`;
            }
        }

        // 4. 人物（全量列出，阶段内不变）
        if (memory.characters.length > 0) {
            const sorted = [...memory.characters].sort((a, b) => {
                const aIsActive = a.status === '活跃' || a.status === '主要';
                const bIsActive = b.status === '活跃' || b.status === '主要';
                if (aIsActive && !bIsActive) return -1;
                if (!aIsActive && bIsActive) return 1;
                return 0;
            });
            
            context += `\n【人物（共${sorted.length}人）】\n`;
            sorted.forEach(c => {
                const desc = (c.description || '').substring(0, 60);
                context += `- ${c.name}【${c.status || '未知'}】${desc}\n`;
            });

            // 角色关系网络
            if (memory.characterRelations && Object.keys(memory.characterRelations).length > 0) {
                const relKeys = Object.keys(memory.characterRelations);
                const displayKeys = relKeys.slice(0, 30);
                const relLines = displayKeys.map(k => {
                    const r = memory.characterRelations[k];
                    return `${k}：${r.type}`;
                }).join('，');
                context += `【角色关系】${relLines}\n`;
            }
        }

        // 5. 世界状态（阶段内通常不变）
        if (memory.worldState && Object.keys(memory.worldState).length > 0) {
            context += `\n【世界状态】\n`;
            const wsKeys = Object.keys(memory.worldState);
            wsKeys.forEach(k => {
                const ws = memory.worldState[k];
                const val = typeof ws === 'object' ? ws.value : ws;
                const updatedAt = typeof ws === 'object' ? (ws.updatedAt ? `（${ws.updatedAt}）` : '') : '';
                context += `- ${k}：${val}${updatedAt}\n`;
            });
        }

        // ================================================================
        // 第二部分：可变信息（每章变化，放在末尾以保持前缀可缓存）
        // ================================================================

        context += `\n【全书进度】共${totalChapters}章，当前写作第${chapterOrder}章\n`;

        // 6. 因果链
        if (memory.causalChain && memory.causalChain.length > 0) {
            const recentCausal = memory.causalChain.slice(-60);
            if (recentCausal.length > 15) {
                context += `\n【故事因果链（关键脉络）】\n`;
                const early = recentCausal.slice(0, Math.min(5, Math.floor(recentCausal.length / 3)));
                early.forEach(c => context += `[${c.chapter}] ${c.event}\n`);
                context += `...\n`;
                const recent = recentCausal.slice(-15);
                recent.forEach(c => context += `[${c.chapter}] ${c.event}\n`);
            } else {
                context += `\n【故事因果链】\n`;
                recentCausal.forEach(c => context += `[${c.chapter}] ${c.event}\n`);
            }
        }

        // 7. 章节摘要：分层处理
        if (memory.chapterSummaries.length > 0) {
            const recentSummaries = memory.chapterSummaries.slice(-10);
            context += `\n【近期章节（第${recentSummaries[0]?.chapterNum || '?'}-${recentSummaries[recentSummaries.length - 1]?.chapterNum || '?'}章）】\n`;
            recentSummaries.forEach(s => context += `- ${s.title}：${s.summary}\n`);

            if (totalChapters > 10) {
                const early = memory.chapterSummaries.slice(0, -10);
                if (early.length > 0) {
                    const keyMarkers = ['转折', '发现', '决定', '死亡', '背叛', '真相', '离开', '回归', '战斗', '觉醒', '决裂', '结盟'];
                    const keyIndices = new Set();
                    
                    for (let i = 0; i < early.length; i += 3) {
                        keyIndices.add(i);
                    }
                    early.forEach((s, i) => {
                        if (keyMarkers.some(m => s.summary.includes(m))) {
                            keyIndices.add(i);
                        }
                    });
                    
                    const sorted = [...keyIndices].sort((a, b) => a - b).slice(0, 30);
                    if (sorted.length > 0) {
                        context += `\n【前期脉络（第${early[0].chapterNum || 1}-${early[early.length - 1].chapterNum || '?'}章，关键节点摘要）】\n`;
                        sorted.forEach(i => {
                            context += `→ ${early[i].title}：${early[i].summary}\n`;
                        });
                    }
                }
            }
        }

        // 8. 伏笔：区分已回收/未回收
        if (memory.plotHooks.length > 0) {
            const hooks = memory.plotHooks;
            const unresolved = hooks.filter(h => {
                if (typeof h === 'string') return true;
                return !h.resolved;
            });
            const resolved = hooks.filter(h => {
                if (typeof h === 'string') return false;
                return h.resolved;
            });

            context += `\n【伏笔追踪（未回收${unresolved.length}/已回收${resolved.length}）】\n`;
            unresolved.forEach(h => {
                const desc = typeof h === 'string' ? h : h.description || '';
                const planted = typeof h === 'string' ? '' : (h.plantedChapter ? `[埋于${h.plantedChapter}]` : '');
                context += `- ⚠未回收：${desc} ${planted}\n`;
            });
            if (resolved.length > 0) {
                const recentResolved = resolved.slice(-10);
                recentResolved.forEach(h => {
                    const desc = typeof h === 'string' ? h : h.description || '';
                    const resolvedCh = typeof h === 'string' ? '' : (h.resolvedChapter ? `[收于${h.resolvedChapter}]` : '');
                    context += `- ✓已回收：${desc} ${resolvedCh}\n`;
                });
                if (resolved.length > 10) {
                    context += `  ...及其他${resolved.length - 10}个已回收伏笔\n`;
                }
            }
        }

        // 9. 关键事件时间线
        if (memory.keyEvents.length > 0) {
            const events = memory.keyEvents;
            if (events.length <= 30) {
                context += `\n【关键事件时间线】\n`;
                events.forEach(e => context += `- ${e}\n`);
            } else {
                const step = Math.max(1, Math.ceil(events.length / 30));
                context += `\n【关键事件时间线（共${events.length}条，采样）】\n`;
                context += `- ${events[0]}\n`;
                for (let i = step; i < events.length - 1; i += step) {
                    context += `- ${events[i]}\n`;
                }
                context += `- ${events[events.length - 1]}\n`;
            }
        }

        return context;
    },

    /**
     * 从分阶段大纲中提取当前章节相关的上下文。
     * 
     * 提取策略（四层）：
     * 1. 当前阶段蓝图（按章节范围精确命中）
     * 2. 全局模块（爆点与高潮分布、人物弧光、伏笔计划、钩子策略）→ 全文保留
     * 3. 一句话卖点 → 全文保留
     * 
     * 全局模块体积小（通常 1000-2000 字合计），但对 AI 理解整体节奏至关重要，
     * 因此不裁剪，确保批量生成时也不丢失这些信息。
     */
    _extractStageContext(outline, chapterOrder) {
        // ========== 第一步：提取当前阶段 ==========
        let stageText = this._extractCurrentStage(outline, chapterOrder);

        // ========== 第二步：提取全局模块 ==========
        const globalModules = this._extractGlobalModules(outline);

        // ========== 第三步：提取一句话卖点 ==========
        const sellPoint = this._extractSellPoint(outline);

        // ========== 组装结果 ==========
        let result = '';
        if (sellPoint) result += `【故事核心】\n${sellPoint}\n\n`;
        if (stageText) result += `【当前阶段蓝图】\n${stageText}\n\n`;
        if (globalModules) result += globalModules;

        // 最终降级：如果什么都没提取到，返回大纲前1200字
        if (!result.trim()) return outline.substring(0, 1200);

        return result.trim();
    },

    /**
     * 从大纲中提取当前章节所在的阶段文本
     */
    _extractCurrentStage(outline, chapterOrder) {
        const stagePattern = /(?:#{1,4}\s*)?第[一二三四五六七八九十\d]+阶段[：:][^\n]*\n([\s\S]*?)(?=(?:#{1,4}\s*)?第[一二三四五六七八九十\d]+阶段|#{1,4}\s*(?:一|二|三|四|五|六|七|八|九|十)[、\s]|$)/g;
        let match;
        let bestStage = '';
        let bestDistance = Infinity;

        while ((match = stagePattern.exec(outline)) !== null) {
            const stageText = match[0];
            const chRange = stageText.match(/第(\d+)[-~至](\d+)章/);
            if (chRange) {
                const start = parseInt(chRange[1]);
                const end = parseInt(chRange[2]);
                if (chapterOrder >= start && chapterOrder <= end) {
                    return stageText.substring(0, 800);
                }
                const dist = Math.min(Math.abs(chapterOrder - start), Math.abs(chapterOrder - end));
                if (dist < bestDistance) {
                    bestDistance = dist;
                    bestStage = stageText.substring(0, 800);
                }
            }
        }

        if (bestStage) return bestStage;

        // 降级：匹配 "第X-XX章" 格式
        const altPattern = /(?:#{1,4}\s*)?(第\d+[-~至]\d+章[^\n]*)\n([\s\S]*?)(?=(?:#{1,4}\s*)?第\d+[-~至]|#{1,4}\s*(?:一|二|三|四|五|六|七|八|九|十)[、\s]|$)/g;
        while ((match = altPattern.exec(outline)) !== null) {
            const rangeMatch = match[1].match(/第(\d+)[-~至](\d+)章/);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1]);
                const end = parseInt(rangeMatch[2]);
                if (chapterOrder >= start && chapterOrder <= end) {
                    return (match[1] + '\n' + match[2]).substring(0, 800);
                }
            }
        }

        return '';
    },

    /**
     * 从大纲中提取全局模块：爆点与高潮分布、人物弧光、伏笔计划、章末钩子策略
     * 这些模块在大纲中位于 "### 三、" 到 "### 六、"，体积可控但信息密度高
     */
    _extractGlobalModules(outline) {
        const modules = [];
        
        // 提取 "### 三、爆点与高潮分布"
        const burstMatch = this._extractSection(outline, /#{1,4}\s*三[、.\s]*(爆点|高潮|节奏)/i, /#{1,4}\s*四[、.\s]/i);
        if (burstMatch) modules.push(`【爆点与高潮分布】\n${burstMatch}`);

        // 提取 "### 四、人物弧光"
        const arcMatch = this._extractSection(outline, /#{1,4}\s*四[、.\s]*(人物弧光|角色弧光|人物成长)/i, /#{1,4}\s*五[、.\s]/i);
        if (arcMatch) modules.push(`【人物弧光】\n${arcMatch}`);

        // 提取 "### 五、伏笔埋设与回收计划"
        const hookPlanMatch = this._extractSection(outline, /#{1,4}\s*五[、.\s]*(伏笔|埋伏|线索)/i, /#{1,4}\s*六[、.\s]/i);
        if (hookPlanMatch) modules.push(`【伏笔埋设与回收计划】\n${hookPlanMatch}`);

        // 提取 "### 六、章末钩子策略"
        const hookStrategyMatch = this._extractSection(outline, /#{1,4}\s*六[、.\s]*(钩子|章末|结尾)/i, /#{1,4}\s*(七|总结|备注|附录)/i);
        if (hookStrategyMatch) modules.push(`【章末钩子策略】\n${hookStrategyMatch}`);

        return modules.length > 0 ? modules.join('\n\n') + '\n' : '';
    },

    /**
     * 从文本中提取两个标记之间的章节内容
     * @param {string} text - 源文本
     * @param {RegExp} startPattern - 起始标记正则
     * @param {RegExp} endPattern - 结束标记正则（可选，不传则取到文末）
     */
    _extractSection(text, startPattern, endPattern) {
        const startMatch = text.match(startPattern);
        if (!startMatch) return '';

        const startIdx = text.indexOf(startMatch[0]);
        let endIdx = text.length;

        if (endPattern) {
            const remaining = text.substring(startIdx + startMatch[0].length);
            const endMatch = remaining.match(endPattern);
            if (endMatch) {
                endIdx = startIdx + startMatch[0].length + remaining.indexOf(endMatch[0]);
            }
        }

        const section = text.substring(startIdx, endIdx).trim();
        // 去除标题行本身，只保留内容
        const contentStart = section.indexOf('\n');
        if (contentStart >= 0) {
            return section.substring(contentStart + 1).trim();
        }
        return '';
    },

    /**
     * 从大纲中提取一句话卖点
     */
    _extractSellPoint(outline) {
        const match = outline.match(/#{1,4}\s*一[、.\s]*(?:一句话卖点|核心卖点|卖点)[^\n]*\n([\s\S]*?)(?=\n#{1,4}\s*二[、.\s]|$)/i);
        if (match) return match[1].trim();
        return '';
    },

    /**
     * 自动更新记忆：从章节内容中提取并更新
     * 增强版：AI标注优先 + 程序化降级
     * 
     * 注意：如果【摘要】标记缺失，summary 字段留空，
     * 由调用方通过 generateChapterSummary() 异步补上 AI 一句话摘要。
     * 不再使用不准确的程序化摘要。
     */
    autoUpdateMemory(bookId, chapterTitle, chapterContent, chapterOrder) {
        if (!chapterContent) return;
        
        const memoryUpdate = this.extractMemoryFromResponse(chapterContent);
        const extendedMemory = this.extractExtendedMemory(chapterContent);

        // 记录 AI 是否输出了【摘要】标记（在赋值空字符串之前保存原始判断）
        const summaryMissing = !memoryUpdate.summary;

        // 如果AI没有输出【摘要】标记，标记为缺失（由调用方异步补AI摘要）
        if (summaryMissing) {
            memoryUpdate.summary = '';
        }

        // 如果AI没有输出【新人物】，从Spec和正文中提取
        if (memoryUpdate.characters.length === 0) {
            memoryUpdate.characters = this._extractCharactersFromContent(chapterContent, bookId, chapterOrder);
        }

        // 如果AI没有输出【新伏笔】，从正文中检测
        if (memoryUpdate.plotHooks.length === 0) {
            memoryUpdate.plotHooks = this._detectPlotHooksFromContent(chapterContent);
        }

        // 合并AI标记的扩展信息和程序化提取的信息
        const relations = { ...extendedMemory.relations, ...this._extractCharacterRelations(chapterContent) };
        const worldChanges = { ...extendedMemory.worldChanges, ...this._extractWorldStateChanges(chapterContent) };
        const resolvedHooks = [
            ...extendedMemory.resolvedHooks,
            ...this._extractResolvedHooks(chapterContent)
        ];
        const causalEvent = this._extractCausalEvent(chapterContent);

        // 更新记忆
        this.addChapterMemory(
            bookId,
            chapterTitle,
            memoryUpdate.summary,
            memoryUpdate.characters,
            memoryUpdate.plotHooks,
            memoryUpdate.keyEvents,
            {
                relations: relations,
                worldChanges: worldChanges,
                resolvedHooks: resolvedHooks,
                causalEvent: causalEvent
            }
        );

        // 返回摘要是否缺失，供调用方判断是否需要AI补摘要
        return { summaryMissing, chapterOrder };
    },

    /**
     * 程序化生成摘要（仅作终极降级，不建议依赖）
     * 策略：从正文前20%处提取最包含动作/人物的段落前80字
     * 如果AI标注【摘要】存在，应优先使用AI标注。
     */
    _generateProgrammaticSummary(content) {
        const clean = content.replace(/【摘要】[\s\S]*?(?=【|$)/g, '')
            .replace(/【新人物】[\s\S]*?(?=【|$)/g, '')
            .replace(/【新伏笔】[\s\S]*?(?=【|$)/g, '')
            .trim();
        if (!clean) return '';
        
        const paragraphs = clean.split(/\n\n+/).filter(p => p.trim().length > 20);
        if (paragraphs.length === 0) {
            return clean.substring(0, 80).replace(/\n/g, ' ').trim();
        }
        
        // 取前20%的段落，优先选包含动作/对话的（而非纯描写）
        const candidateCount = Math.max(1, Math.floor(paragraphs.length * 0.2));
        const candidates = paragraphs.slice(0, candidateCount);
        
        // 打分：有对话引号 +20，有人名 +15，有动作动词 +10
        const scored = candidates.map(p => {
            let score = 0;
            if (p.includes('"') || p.includes('"') || p.includes('「')) score += 20;
            if (/[刘陈张李王杨赵黄周吴][^\s，。！？]{1,3}/.test(p)) score += 15;
            if (/[杀砍冲跳飞跃击刺劈斩推拉拽踢踏奔逃闪躲追].*[杀砍冲跳飞跃击刺劈斩推拉拽踢踏奔逃闪躲追]/.test(p)) score += 10;
            return { para: p, score };
        });
        scored.sort((a, b) => b.score - a.score);
        
        return scored[0].para.substring(0, 80).replace(/\n/g, ' ').trim();
    },

    /**
     * 从正文中程序化提取人物信息
     * 策略：检测高频出现的人名模式（引号对话前、动作描写前）
     */
    _extractCharactersFromContent(content, bookId, chapterOrder) {
        const clean = content.replace(/【摘要】[\s\S]*?(?=【|$)/g, '')
            .replace(/【新人物】[\s\S]*?(?=【|$)/g, '')
            .replace(/【新伏笔】[\s\S]*?(?=【|$)/g, '')
            .trim();
        if (!clean) return [];
        
        const characters = [];
        const existingMemory = this.getMemory(bookId);
        const existingNames = new Set(existingMemory.characters.map(c => c.name));
        
        // 模式1：中文姓名模式（2-4字，含常见姓氏）
        const namePattern = /([刘陈张李王杨赵黄周吴徐孙马胡朱郭何林高罗郑梁谢宋唐许邓韩冯曹彭曾萧田董潘袁蔡蒋余于杜叶程苏魏吕丁任卢姚钟姜崔谭陆范汪廖石金韦贾夏付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤温康施文牛樊]{1}[^\s，。！？、：；""''（）《》\n]{1,3})/g;
        let nameMatch;
        while ((nameMatch = namePattern.exec(clean)) !== null) {
            const name = nameMatch[1];
            // 过滤明显不是人名的（如包含动词、数字）
            if (!existingNames.has(name) && !name.match(/[的得了着过在是和]/) && name.length >= 2) {
                existingNames.add(name);
                characters.push({ name: name, description: '', status: '活跃' });
            }
        }
        
        // 模式2：从Spec中获取
        const spec = this.getChapterSpec(bookId, chapterOrder);
        if (spec) {
            const specChars = spec.match(/-\s*\{name:\s*"([^"]+)"[^}]*\}/g);
            if (specChars) {
                specChars.forEach(m => {
                    const nameMatch = m.match(/name:\s*"([^"]+)"/);
                    const stateMatch = m.match(/state:\s*"([^"]+)"/);
                    if (nameMatch) {
                        const specName = nameMatch[1];
                        if (!existingNames.has(specName)) {
                            existingNames.add(specName);
                            characters.push({
                                name: specName,
                                description: stateMatch ? stateMatch[1] : '',
                                status: '活跃'
                            });
                        }
                    }
                });
            }
        }
        
        return characters;
    },

    /**
     * 从正文中检测伏笔线索
     * 关键词模式匹配
     */
    _detectPlotHooksFromContent(content) {
        const hooks = [];
        const hookPatterns = [
            /(?:似乎|仿佛|隐约|莫名|不知为何|总觉得)(.{5,30})(?:[。！？])/g,
            /(?:没有注意到|无人知晓|谁也不知道|没人发现)(.{5,30})(?:[。！？])/g,
            /(?:留下|剩下|残留)(?:了)?(?:一个|一道|一件)(.{5,30})(?:[。！？])/g,
            /(?:意味深长|若有所思|欲言又止|神色异样)(.{5,20})(?:[。！？])/g,
            /(?:秘密|真相|隐情|背后|真正的原因)(.{5,30})(?:[。！？])/g
        ];
        
        const seen = new Set();
        hookPatterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const hook = match[1].trim();
                if (hook && hook.length > 3 && !seen.has(hook)) {
                    seen.add(hook);
                    hooks.push(hook);
                }
            }
        });
        
        return hooks.slice(0, 3); // 最多取3个
    },

    /**
     * 从正文中提取角色关系变化
     */
    _extractCharacterRelations(content) {
        const relations = {};
        // 检测关系变化模式：A和B的关系描述
        const relPattern = /([^\s]{2,4})[和与]([^\s]{2,4})(?:的)?(?:关系|之间)?(?:变得|成了|转变为|升级为|降级为|决裂|结盟|和解|对立)([^。！？]{2,15})/g;
        let match;
        while ((match = relPattern.exec(content)) !== null) {
            const a = match[1];
            const b = match[2];
            const relType = match[3].trim();
            if (a && b && a !== b) {
                const key = [a, b].sort().join('↔');
                if (!relations[key]) {
                    relations[key] = { type: relType };
                }
            }
        }
        return relations;
    },

    /**
     * 从正文中提取世界状态变化
     */
    _extractWorldStateChanges(content) {
        const changes = {};
        // 检测全局性变化描述
        const patterns = [
            /(?:从(?:此|那以后|今以后))[,，]?\s*(.{10,40})(?:[。！？])/g,
            /(?:整个|全|所有)(.{4,20})(?:被|遭到|已经|彻底|完全)(.{5,25})(?:[。！？])/g,
            /(?:世界|大陆|城市|王国|帝国|势力)(.{5,30})(?:覆灭|崩塌|沦陷|易主|统一|分裂|消失)(?:[。！？])/g
        ];
        
        patterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const key = match[1].trim();
                const value = (match[2] || '').trim() || match[1].trim();
                if (key && !changes[key]) {
                    changes[key] = value;
                }
            }
        });
        
        return changes;
    },

    /**
     * 从正文中检测伏笔回收
     */
    _extractResolvedHooks(content) {
        const resolved = [];
        const resolvePatterns = [
            /(?:原来|终于明白|这才知道|终于知道|才意识到)(.{5,40})(?:[。！？])/g,
            /(?:揭开了|解开了|真相大白|水落石出)(.{5,30})(?:[。！？])/g,
            /(?:果然|不出所料|正如.*所料)(.{5,30})(?:[。！？])/g
        ];
        
        const seen = new Set();
        resolvePatterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const hook = match[1].trim();
                if (hook && hook.length > 3 && !seen.has(hook)) {
                    seen.add(hook);
                    resolved.push(hook);
                }
            }
        });
        
        return resolved;
    },

    /**
     * 从正文中提取因果事件
     */
    _extractCausalEvent(content) {
        const clean = content.replace(/【摘要】[\s\S]*?(?=【|$)/g, '')
            .replace(/【新人物】[\s\S]*?(?=【|$)/g, '')
            .replace(/【新伏笔】[\s\S]*?(?=【|$)/g, '')
            .trim();
        
        // 找最核心的事件描述：取正文中段的代表性段落
        const paragraphs = clean.split(/\n\n+/).filter(p => p.trim().length > 30);
        if (paragraphs.length === 0) return null;
        
        // 取后1/3处的段落作为核心事件
        const idx = Math.floor(paragraphs.length * 0.7);
        const corePara = paragraphs[Math.min(idx, paragraphs.length - 1)];
        
        // 截取前80字作为事件摘要
        const event = corePara.substring(0, 80).replace(/\n/g, ' ').trim();
        
        // 尝试提取因果关系关键词
        let cause = '', effect = '';
        const causeMatch = corePara.match(/因为|由于|因(.{10,40})(?:[，。])/);
        const effectMatch = corePara.match(/所以|因此|导致|结果|于是(.{10,40})(?:[，。])/);
        if (causeMatch) cause = causeMatch[0].substring(0, 30);
        if (effectMatch) effect = effectMatch[0].substring(0, 30);
        
        return { event, cause, effect };
    },

    // ============ 创作规划存储（设定/大纲/章节规划，与正文分离） ============
    getPlans(bookId) {
        try {
            return JSON.parse(localStorage.getItem(`plans_${bookId}`) || '{"setting":"","outline":"","chapter_plan":"","chapter_blueprint":""}');
        } catch { return { setting: '', outline: '', chapter_plan: '' }; }
    },

    savePlan(bookId, planKey, content) {
        const plans = this.getPlans(bookId);
        plans[planKey] = content;
        this._safeSetItem(`plans_${bookId}`, JSON.stringify(plans));
        this._triggerAutoBackup();
    },

    // ============ 章节Spec存储 ============
    getChapterSpec(bookId, chapterOrder) {
        try {
            const specs = JSON.parse(localStorage.getItem(`specs_${bookId}`) || '{}');
            return specs[chapterOrder] || '';
        } catch { return ''; }
    },

    saveChapterSpec(bookId, chapterOrder, spec) {
        try {
            const specs = JSON.parse(localStorage.getItem(`specs_${bookId}`) || '{}');
            specs[chapterOrder] = spec;
            this._safeSetItem(`specs_${bookId}`, JSON.stringify(specs));
        } catch {}
    },

    getRecentChapterSpecs(bookId, count = 3) {
        try {
            const specs = JSON.parse(localStorage.getItem(`specs_${bookId}`) || '{}');
            const orders = Object.keys(specs).map(Number).sort((a, b) => b - a);
            const recent = orders.slice(0, count).sort((a, b) => a - b);
            return recent.map(o => `### 第${o}章\n${specs[o]}`).join('\n\n');
        } catch { return ''; }
    },

    getPreviousChapterContent(bookId, chapterOrder) {
        const chapters = this.getChapters(bookId);
        // 获取前3章：最近1章取结尾1000字，前2章各取结尾500字
        const prevChapters = chapters
            .filter(c => c.order < chapterOrder && c.content)
            .sort((a, b) => b.order - a.order)
            .slice(0, 3)
            .reverse();
        
        if (prevChapters.length === 0) return '';
        
        return prevChapters.map((c, idx) => {
            // 最近一章取更多内容（1000字），更早的取500字
            const takeChars = (idx === prevChapters.length - 1) ? 1000 : 500;
            const tail = c.content?.substring(Math.max(0, (c.content?.length || 0) - takeChars)) || '';
            return `【第${c.order}章结尾】${tail}`;
        }).join('\n\n');
    },

    // ============ 评审存储 ============
    getChapterReview(bookId, chapterOrder) {
        try {
            const reviews = JSON.parse(localStorage.getItem(`reviews_${bookId}`) || '{}');
            return reviews[chapterOrder] || '';
        } catch { return ''; }
    },

    saveChapterReview(bookId, chapterOrder, review) {
        try {
            const reviews = JSON.parse(localStorage.getItem(`reviews_${bookId}`) || '{}');
            reviews[chapterOrder] = review;
            this._safeSetItem(`reviews_${bookId}`, JSON.stringify(reviews));
        } catch {}
    },

    /**
     * 程序化矛盾检测：检查新章节内容是否与已有记忆冲突
     * 返回 { hasIssues, issues[] } 结构
     * 检测维度：
     * 1. 人物状态冲突（死亡角色再次活跃）
     * 2. 人物关系冲突（已决裂的角色突然亲密）
     * 3. 世界状态冲突（已摧毁的城市再次出现）
     * 4. 伏笔重复回收
     */
    detectContradictions(bookId, chapterContent, chapterOrder) {
        const memory = this.getMemory(bookId);
        const issues = [];
        const clean = (chapterContent || '').replace(/【摘要】[\s\S]*?(?=【|$)/g, '')
            .replace(/【新人物】[\s\S]*?(?=【|$)/g, '')
            .replace(/【新伏笔】[\s\S]*?(?=【|$)/g, '')
            .trim();
        if (!clean) return { hasIssues: false, issues: [] };

        // 1. 检测死亡/离开角色是否再次出现
        memory.characters.forEach(c => {
            if ((c.status === '死亡' || c.status === '已死' || c.status === '离开') && clean.includes(c.name)) {
                // 检查是否在"回忆"或"幻觉"上下文中
                const nameIdx = clean.indexOf(c.name);
                const context = clean.substring(Math.max(0, nameIdx - 30), Math.min(clean.length, nameIdx + 30));
                if (!context.match(/回忆|想起|梦中|幻觉|幻影|记忆|曾经|过去|如果|假如/)) {
                    issues.push({
                        type: 'status_conflict',
                        severity: 'P0',
                        character: c.name,
                        detail: `角色"${c.name}"状态为"${c.status}"，但在第${chapterOrder}章正文中再次出现，且非回忆/幻觉上下文`,
                        suggestion: `如为回忆场景需明确标注；如角色确实回归需更新角色状态`
                    });
                }
            }
        });

        // 2. 检测角色关系冲突
        if (memory.characterRelations) {
            Object.keys(memory.characterRelations).forEach(pairKey => {
                const rel = memory.characterRelations[pairKey];
                const [a, b] = pairKey.split('↔');
                if (rel.type && rel.type.includes('决裂') && clean.includes(a) && clean.includes(b)) {
                    // 检查是否有亲密互动
                    const aIdx = clean.indexOf(a);
                    const bIdx = clean.indexOf(b);
                    if (Math.abs(aIdx - bIdx) < 200) { // 两人在200字内同时出现
                        const nearby = clean.substring(
                            Math.max(0, Math.min(aIdx, bIdx) - 50),
                            Math.min(clean.length, Math.max(aIdx, bIdx) + 50)
                        );
                        if (nearby.match(/拥抱|牵手|亲吻|亲密|依靠|依赖|信任|默契/)) {
                            issues.push({
                                type: 'relation_conflict',
                                severity: 'P1',
                                character: pairKey,
                                detail: `${pairKey} 关系为"${rel.type}"，但正文中有亲密互动`,
                                suggestion: `请确认关系是否需要更新，或修改互动描写`
                            });
                        }
                    }
                }
            });
        }

        // 3. 检测世界状态冲突
        if (memory.worldState) {
            Object.keys(memory.worldState).forEach(k => {
                const ws = memory.worldState[k];
                const val = typeof ws === 'object' ? ws.value : ws;
                if (typeof val === 'string' && (val.includes('毁灭') || val.includes('摧毁') || val.includes('消失') || val.includes('覆灭'))) {
                    if (clean.includes(k)) {
                        const kIdx = clean.indexOf(k);
                        const context = clean.substring(Math.max(0, kIdx - 30), Math.min(clean.length, kIdx + 30));
                        if (context.match(/前往|来到|到达|进入|在/)) {
                            issues.push({
                                type: 'world_state_conflict',
                                severity: 'P1',
                                character: k,
                                detail: `"${k}"的世界状态为"${val}"，但正文中人物可能前往/进入了该地点`,
                                suggestion: `如该地点已不可进入需修正；如可进入需更新世界状态`
                            });
                        }
                    }
                }
            });
        }

        // 4. 检测伏笔重复回收
        if (memory.hookResolved) {
            const resolvedSet = new Set(Object.keys(memory.hookResolved));
            // 检查新内容中的"原来/终于知道"类表述是否匹配已回收伏笔
            const revealMatches = clean.match(/(?:原来|终于知道|终于明白|这才明白)(.{8,40})(?:[。！？])/g);
            if (revealMatches) {
                revealMatches.forEach(m => {
                    const core = m.substring(2, Math.min(m.length, 30)).trim();
                    resolvedSet.forEach(resolvedHook => {
                        if (this._textSimilarity(core, resolvedHook) > 0.6) {
                            issues.push({
                                type: 'hook_duplicate_resolve',
                                severity: 'P1',
                                character: core,
                                detail: `伏笔"${resolvedHook}"已在${memory.hookResolved[resolvedHook]}回收，但本章再次出现类似揭示`,
                                suggestion: `确认是否为新伏笔回收还是重复内容`
                            });
                        }
                    });
                });
            }
        }

        return {
            hasIssues: issues.length > 0,
            issues: issues.slice(0, 10) // 最多返回10个问题
        };
    },

    /**
     * 简单文本相似度计算（Jaccard系数）
     */
    _textSimilarity(a, b) {
        if (!a || !b) return 0;
        const setA = new Set(a.split(''));
        const setB = new Set(b.split(''));
        const intersection = [...setA].filter(x => setB.has(x)).length;
        const union = new Set([...setA, ...setB]).size;
        return union === 0 ? 0 : intersection / union;
    },

    /**
     * 从 AI 回复中提取记忆信息（支持新旧两种标记格式）
     */
    extractMemoryFromResponse(response) {
        const memoryUpdate = {
            characters: [],
            plotHooks: [],
            keyEvents: [],
            summary: ''
        };

        // 提取摘要
        const summaryMatch = response.match(/【摘要】([\s\S]*?)(?=【|$)/);
        if (summaryMatch) memoryUpdate.summary = summaryMatch[1].trim();

        // 提取新人物
        const charMatch = response.match(/【新人物】([\s\S]*?)(?=【|$)/);
        if (charMatch) {
            const chars = charMatch[1].split('\n').filter(c => c.trim());
            chars.forEach(c => {
                const parts = c.replace(/^[-•]\s*/, '').split('：');
                memoryUpdate.characters.push({
                    name: parts[0].trim(),
                    description: parts[1] ? parts[1].trim() : '',
                    status: '活跃'
                });
            });
        }

        // 提取伏笔
        const hookMatch = response.match(/【新伏笔】([\s\S]*?)(?=【|$)/);
        if (hookMatch) {
            memoryUpdate.plotHooks = hookMatch[1].split('\n')
                .filter(h => h.trim())
                .map(h => h.replace(/^[-•]\s*/, '').trim());
        }

        return memoryUpdate;
    },

    /**
     * 从 AI 回复中提取扩展记忆信息（关系变化、伏笔回收、世界状态变化）
     */
    extractExtendedMemory(response) {
        const extended = {
            resolvedHooks: [],
            relations: {},
            worldChanges: {}
        };

        // 提取已回收伏笔
        const resolvedMatch = response.match(/【已回收伏笔】([\s\S]*?)(?=【|$)/);
        if (resolvedMatch) {
            extended.resolvedHooks = resolvedMatch[1].split('\n')
                .filter(h => h.trim())
                .map(h => h.replace(/^[-•]\s*/, '').trim());
        }

        // 提取人物关系变化
        const relMatch = response.match(/【人物关系变化】([\s\S]*?)(?=【|$)/);
        if (relMatch) {
            const rels = relMatch[1].split('\n').filter(r => r.trim());
            rels.forEach(r => {
                const clean = r.replace(/^[-•]\s*/, '').trim();
                const parts = clean.split('：');
                if (parts.length >= 2) {
                    const pair = parts[0].trim();
                    const type = parts[1].trim();
                    // 标准化pair格式：A-B 或 A↔B
                    const pairKey = pair.replace(/[-–—]/g, '↔');
                    extended.relations[pairKey] = { type };
                }
            });
        }

        // 提取世界状态变化
        const worldMatch = response.match(/【世界状态变化】([\s\S]*?)(?=【|$)/);
        if (worldMatch) {
            const changes = worldMatch[1].split('\n').filter(w => w.trim());
            changes.forEach(w => {
                const clean = w.replace(/^[-•]\s*/, '').trim();
                const parts = clean.split('：');
                if (parts.length >= 2) {
                    extended.worldChanges[parts[0].trim()] = parts[1].trim();
                }
            });
        }

        return extended;
    },

    // 暴露 IndexedDB 适配器供外部使用
    _chapterDB: ChapterDB,
};
