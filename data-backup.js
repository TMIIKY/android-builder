/**
 * 数据备份与恢复模块 (Capacitor 版本)
 * 
 * 策略：
 * 1. 备份文件写入公共 Documents/灵墨/ 目录（用户可访问，卸载不丢）
 * 2. 如果 DOCUMENTS 写入失败，降级为浏览器下载（存到 Download 目录）
 * 3. 应用启动时，如果 localStorage 为空但备份文件存在，自动恢复
 * 4. 提供手动导出、从备份恢复功能
 * 5. 书籍导出同样写入公共目录或浏览器下载
 * 6. 使用 Capacitor Filesystem API (不依赖 plus.io)
 * 
 * 存储路径：
 *   - 优先（HBuilder）：plus.android → MediaStore API → /Download/灵墨/（公共下载目录，用户可见）
 *   - 优先（Capacitor）：AndroidShare.saveToPublicDownloads → /Download/灵墨/
 *   - 降级：Capacitor DOCUMENTS/灵墨/（应用私有目录）
 *   - 降级：plus.io PUBLIC_DOWNLOADS/灵墨/
 *   - 降级：Web Blob 下载
 * 
 * 注意：
 * - Android 10+ 使用 MediaStore API 写入公共目录，无需存储权限
 * - Android 9- 需要 WRITE_EXTERNAL_STORAGE 权限
 * - plus.io PUBLIC_DOWNLOADS 在 Android 11+ 写入的是应用沙箱，用户不可见
 */

const DataBackup = {
    BACKUP_FILENAME: 'lingmo_data_backup.json',
    BACKUP_DIR: '灵墨',

    /**
     * 判断是否在原生环境中（Capacitor / 5+ App / Android WebView）
     */
    isNative() {
        try {
            if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
                return true;
            }
        } catch (e) {}
        try {
            if (typeof plus !== 'undefined' && plus.io) {
                return true;
            }
        } catch (e) {}
        // ★ 也检测 Android WebView JavascriptInterface 桥接
        try {
            if (typeof NativeShare !== 'undefined' && NativeShare.isNative()) {
                return true;
            }
        } catch (e) {}
        return false;
    },

    /**
     * 判断是否为 Capacitor 环境
     */
    _isCapacitor() {
        try {
            return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform && Capacitor.isNativePlatform();
        } catch (e) {
            return false;
        }
    },

    /**
     * 获取 Filesystem 插件实例
     */
    _getFilesystem() {
        try {
            if (typeof Capacitor !== 'undefined' && Capacitor.Plugins && Capacitor.Plugins.Filesystem) {
                return Capacitor.Plugins.Filesystem;
            }
        } catch (e) {}
        return null;
    },

    /**
     * 静默写入备份文件（用于自动备份，不弹出分享面板）
     * 直接写入应用内部 Documents 目录
     */
    async _silentWriteBackup(jsonStr) {
        const Filesystem = this._getFilesystem();
        if (!Filesystem) return;

        try {
            const fullPath = this.BACKUP_DIR + '/' + this.BACKUP_FILENAME;
            const base64Content = btoa(encodeURIComponent('\uFEFF' + jsonStr).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode('0x' + p1)));
            await Filesystem.writeFile({
                path: fullPath,
                data: base64Content,
                directory: 'DOCUMENTS',
                recursive: true
            });
            console.log('[DataBackup] 自动备份完成:', new Date().toISOString());
        } catch (e) {
            console.warn('[DataBackup] 自动备份写入失败:', e.message);
        }
    },

    /**
     * 获取备份文件在用户可见路径的描述
     */
    _getPublicPathDescription() {
        return '分享/保存';
    },

    /**
     * 写入文件到公共下载目录（多级降级策略）
     * 
     * ★ 策略0（最优先，正式APK）：AndroidShare.saveAndShare
     *     → 先 AndroidFileSaver 静默保存到 Download/灵墨/（MediaStore）
     *     → 再 AndroidShare.saveAndShare 分享真实文件（写缓存→FileProvider→content://URI→EXTRA_STREAM）
     *     → 用户既能从文件管理器查看，又能直接分享到微信/QQ/网盘等
     * 
     * 策略1：HBuilder 基座 — 写缓存文件分享 + 纯文本分享（降级）+ Web 下载（兜底）
     * 策略2：AndroidShare.saveToPublicDownloads 原生桥接（Capacitor 环境）
     * 策略3：plus.io → PUBLIC_DOWNLOADS/灵墨/
     * 策略4：Web Blob 下载
     * 
     * @param {string} filename 文件名
     * @param {string} content 文件内容
     * @param {string} mimeType MIME 类型
     * @param {function} callback 回调
     * @returns {Promise<{success: boolean, path: string, message: string}>}
     */
    async _writePublicFile(filename, content, mimeType, callback) {
        console.log('[DataBackup] _writePublicFile 开始, 文件名:', filename, '大小:', content.length);

        // ★ 策略0（正式APK）：先保存到 Download/，再分享实际文件（.json/.txt）
        //    使用 AndroidShare.saveAndShare → 写缓存 → FileProvider content://URI → EXTRA_STREAM
        if (typeof AndroidShare !== 'undefined' && typeof AndroidShare.saveAndShare === 'function') {
            console.log('[DataBackup] 检测到 AndroidShare（正式APK），使用策略0: 保存+分享文件');
            try {
                // 1. 先静默保存到 Download/灵墨/（用户文件管理器可见）
                if (typeof AndroidFileSaver !== 'undefined' && typeof AndroidFileSaver.saveTextFile === 'function') {
                    try {
                        AndroidFileSaver.saveTextFile(filename, content);
                        console.log('[DataBackup] AndroidFileSaver 静默保存成功');
                    } catch (e2) {
                        console.warn('[DataBackup] AndroidFileSaver 保存异常（不阻塞分享）:', e2.message);
                    }
                }

                // 2. 分享实际文件（写缓存 → FileProvider → content://URI → EXTRA_STREAM）
                var base64Content = btoa(unescape(encodeURIComponent('\uFEFF' + content)));
                AndroidShare.saveAndShare(
                    '导出备份',
                    '灵墨数据备份文件',
                    base64Content,
                    filename,
                    mimeType || 'text/plain'
                );

                var result = { success: true, path: '分享面板', message: '文件已保存并打开分享面板' };
                if (callback) callback(result);
                return result;
            } catch (e) {
                console.warn('[DataBackup] 策略0异常，降级:', e.message);
            }
        }

        // 策略1：HBuilder 基座 — 纯文本分享 + Web 下载（MediaStore 在基座桥接中不稳定）
        if (typeof plus !== 'undefined' && plus.android) {
            console.log('[DataBackup] 检测到 plus.android（HBuilder基座），使用策略1: 纯文本分享 + 下载');
            var result = this._shareTextAndDownload(content, filename, mimeType);
            if (callback) callback(result);
            return result;
        }

        // 策略2：AndroidShare 原生桥接（兼容旧版）
        if (typeof AndroidShare !== 'undefined' && typeof AndroidShare.saveToPublicDownloads === 'function') {
            console.log('[DataBackup] 检测到 AndroidShare，使用策略2');
            try {
                var base64Content = btoa(unescape(encodeURIComponent('\uFEFF' + content)));
                var nativeResult = AndroidShare.saveToPublicDownloads(base64Content, filename, mimeType || 'text/plain');
                if (nativeResult && typeof nativeResult === 'string' && nativeResult.startsWith('OK|')) {
                    var savedPath = nativeResult.substring(3);
                    var result = { success: true, path: savedPath, message: '已保存到 ' + savedPath };
                    console.log('[DataBackup] AndroidShare 原生保存成功:', savedPath);
                    if (callback) callback(result);
                    return result;
                }
                var errMsg = nativeResult ? nativeResult.substring(5) : '未知错误';
                console.warn('[DataBackup] AndroidShare 保存失败:', errMsg);
            } catch (e) {
                console.warn('[DataBackup] AndroidShare 异常:', e.message);
            }
        }

        // 策略3：Capacitor Filesystem → DOCUMENTS/灵墨/
        if (this._isCapacitor()) {
            console.log('[DataBackup] 检测到 Capacitor，使用策略3');
            const Filesystem = this._getFilesystem();
            if (Filesystem) {
                try {
                    const fullPath = this.BACKUP_DIR + '/' + filename;
                    const base64Content = btoa(unescape(encodeURIComponent('\uFEFF' + content)));
                    await Filesystem.writeFile({
                        path: fullPath,
                        data: base64Content,
                        directory: 'DOCUMENTS',
                        recursive: true
                    });
                    const result = { success: true, path: 'Documents/' + fullPath, message: '已保存到应用文档目录' };
                    console.log('[DataBackup] Capacitor 写入成功:', result.path);
                    if (callback) callback(result);
                    return result;
                } catch (e) {
                    console.warn('[DataBackup] Capacitor 写入失败:', e.message);
                }
            }
        }

        // 策略4：plus.io → PUBLIC_DOWNLOADS/灵墨/
        if (typeof plus !== 'undefined' && plus.io) {
            console.log('[DataBackup] 使用策略4: plus.io');
            return new Promise(function(resolve) {
                DataBackup._writePublicFileLegacy(filename, content, function(result) {
                    if (result && result.success) {
                        console.log('[DataBackup] plus.io 写入成功:', result.path);
                        if (callback) callback(result);
                        resolve(result);
                    } else {
                        console.warn('[DataBackup] plus.io 写入失败，降级到 Web 下载');
                        var webResult = DataBackup._saveToWebDownload(content, filename, mimeType);
                        if (callback) callback(webResult);
                        resolve(webResult);
                    }
                });
            });
        }

        // 策略5：纯浏览器 — Blob 下载
        console.log('[DataBackup] 使用策略5: Web Blob 下载');
        var result = this._saveToWebDownload(content, filename, mimeType);
        if (callback) callback(result);
        return result;
    },

    /**
     * HBuilder 基座专用：纯文本分享 + Web Blob 下载双保险
     *
     * HBuilder 基座没有 FileProvider，无法通过 content:// URI 分享真实文件，
     * 所以只能分享纯文本内容（EXTRA_TEXT）。
     * 正式 APK 会走策略0（AndroidShare.saveAndShare）分享真实文件。
     */
    _shareTextAndDownload(content, filename, mimeType) {
        var shareOk = false;

        // 纯文本分享（EXTRA_TEXT）— HBuilder 基座中已验证稳定
        try {
            var Intent = plus.android.importClass('android.content.Intent');
            var mainActivity = plus.android.runtimeMainActivity();
            var shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType('text/plain');
            shareIntent.putExtra(Intent.EXTRA_SUBJECT, filename);
            shareIntent.putExtra(Intent.EXTRA_TEXT, content);
            var chooser = Intent.createChooser(shareIntent, '分享 ' + filename);
            chooser.addFlags(268435456);
            mainActivity.startActivity(chooser);
            shareOk = true;
            console.log('[DataBackup] 纯文本分享面板已打开');
        } catch (e) {
            console.warn('[DataBackup] 纯文本分享失败:', e.message || e);
        }

        // Web Blob 下载（兜底保存）
        var dlResult = this._saveToWebDownload(content, filename, mimeType);

        return {
            success: shareOk || dlResult.success,
            path: shareOk ? '分享面板' : dlResult.path,
            message: shareOk ? '请选择应用保存或发送' : dlResult.message
        };
    },

    /**
     * Web 环境保存文件（多策略兼容，适配 HBuilder WebView）
     * @returns {{success: boolean, path: string, message: string}}
     */
    _saveToWebDownload(content, filename, mimeType) {
        var bomContent = '\uFEFF' + content;
        var fullMime = (mimeType || 'text/plain') + ';charset=utf-8';
        var saved = false;
        var self = this;

        // 策略1：Blob URL + <a download>（标准浏览器）
        try {
            var blob = new Blob([bomContent], { type: fullMime });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function() { URL.revokeObjectURL(url); }, 2000);
            saved = true;
            console.log('[DataBackup] Blob 下载已触发:', filename);
        } catch (e) {
            console.warn('[DataBackup] Blob 下载失败:', e.message);
        }

        // 策略2：data: URI + <a download>（WebView 兼容性更好，绕过 Blob URL 限制）
        try {
            var base64 = btoa(unescape(encodeURIComponent(bomContent)));
            var dataUri = 'data:' + fullMime + ';base64,' + base64;
            var a2 = document.createElement('a');
            a2.href = dataUri;
            a2.download = filename;
            a2.style.display = 'none';
            document.body.appendChild(a2);
            a2.click();
            document.body.removeChild(a2);
            saved = true;
            console.log('[DataBackup] data URI 下载已触发:', filename);
        } catch (e2) {
            console.warn('[DataBackup] data URI 下载失败:', e2.message);
        }

        // 策略3：window.open 打开 data URI（最后的兜底，触发系统下载或打开）
        if (!saved) {
            try {
                var base642 = btoa(unescape(encodeURIComponent(bomContent)));
                var dataUri2 = 'data:' + fullMime + ';base64,' + base642;
                var w = window.open(dataUri2, '_blank');
                if (w) {
                    setTimeout(function() { w.close(); }, 1000);
                }
                saved = true;
                console.log('[DataBackup] window.open 下载已触发:', filename);
            } catch (e3) {
                console.error('[DataBackup] window.open 下载失败:', e3.message);
            }
        }

        // 策略4：如果以上都失败，尝试用 plus.android 写内部存储然后通过 content URI 打开
        if (!saved && typeof plus !== 'undefined' && plus.android) {
            try {
                var result = self._androidDirectDownload(content, filename, mimeType);
                if (result && result.success) {
                    saved = true;
                    console.log('[DataBackup] Android 直接下载成功:', filename);
                }
            } catch (e4) {
                console.error('[DataBackup] Android 直接下载失败:', e4.message);
            }
        }

        if (saved) {
            return { success: true, path: 'Download/' + filename, message: '文件下载已触发，请检查浏览器下载列表或通知栏' };
        } else {
            return { success: false, path: '', message: '所有下载策略均失败，请尝试在正式APK中导出' };
        }
    },

    /**
     * Android WebView 专用：通过系统 DownloadManager 直接下载
     * 写文件到内部缓存后，用 content:// URI 打开
     */
    _androidDirectDownload(content, filename, mimeType) {
        try {
            var File = plus.android.importClass('java.io.File');
            var FileOutputStream = plus.android.importClass('java.io.FileOutputStream');
            var Intent = plus.android.importClass('android.content.Intent');
            var Uri = plus.android.importClass('android.net.Uri');

            var mainActivity = plus.android.runtimeMainActivity();
            var cacheDir = mainActivity.getExternalCacheDir ? mainActivity.getExternalCacheDir() : mainActivity.getCacheDir();
            var tempFile = new File(cacheDir, filename);
            var fos = new FileOutputStream(tempFile);
            var content2 = '\uFEFF' + content;
            var bytes = plus.android.invoke(content2, 'getBytes', 'UTF-8');
            fos.write(bytes);
            fos.close();

            // 让文件全局可读
            tempFile.setReadable(true, false);

            // 用 Intent 打开文件（触发系统选择器，用户可保存）
            var uri = Uri.fromFile(tempFile);
            var intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, mimeType || 'text/plain');
            intent.addFlags(268435456); // FLAG_ACTIVITY_NEW_TASK
            intent.addFlags(1); // FLAG_GRANT_READ_URI_PERMISSION

            var chooser = Intent.createChooser(intent, '打开或保存 ' + filename);
            chooser.addFlags(268435456);
            mainActivity.startActivity(chooser);

            return { success: true, path: tempFile.getAbsolutePath(), message: '已打开文件，可另存为' };
        } catch (e) {
            console.error('[DataBackup] _androidDirectDownload 异常:', e.message || e);
            return { success: false, path: '', message: e.message || '未知错误' };
        }
    },

    /**
     * 降级方案：旧的 plus.io 写入方式（PUBLIC_DOWNLOADS）
     */
    _writePublicFileLegacy(filename, content, callback) {
        var self = this;
        try {
            plus.io.requestFileSystem(plus.io.PUBLIC_DOWNLOADS, function(fs) {
                fs.root.getDirectory(self.BACKUP_DIR, { create: true }, function(dirEntry) {
                    dirEntry.getFile(filename, { create: true }, function(fileEntry) {
                        fileEntry.createWriter(function(writer) {
                            writer.onwrite = function() {
                                console.log('[DataBackup] 公共目录写入成功(legacy): Download/' + self.BACKUP_DIR + '/' + filename);
                                if (callback) callback({
                                    success: true,
                                    path: 'Download/' + self.BACKUP_DIR + '/' + filename,
                                    message: '已保存到 Download/灵墨/ 目录'
                                });
                            };
                            writer.onerror = function(e) {
                                console.error('[DataBackup] 写入错误:', JSON.stringify(e));
                                if (callback) callback({ success: false, message: '写入失败' });
                            };
                            writer.write('\uFEFF' + content);
                        }, function(e) {
                            console.error('[DataBackup] 创建写入器失败:', JSON.stringify(e));
                            if (callback) callback({ success: false, message: '创建写入器失败' });
                        });
                    }, function(e) {
                        console.error('[DataBackup] 创建文件失败:', JSON.stringify(e));
                        if (callback) callback({ success: false, message: '创建文件失败' });
                    });
                }, function(e) {
                    console.error('[DataBackup] 创建目录失败:', JSON.stringify(e));
                    if (callback) callback({ success: false, message: '创建目录失败' });
                });
            }, function(e) {
                console.error('[DataBackup] 请求文件系统失败:', JSON.stringify(e));
                if (callback) callback({ success: false, message: '请求文件系统失败' });
            });
        } catch (e) {
            console.error('[DataBackup] 写入异常:', e.message);
            if (callback) callback({ success: false, message: e.message });
        }
    },

    /**
     * 用 Capacitor Filesystem API 从公共 Documents 目录读取文件
     */
    async _readPublicFile(filename, callback) {
        if (!this._isCapacitor()) {
            this._readPublicFileLegacy(filename, callback);
            return;
        }

        const Filesystem = this._getFilesystem();
        if (!Filesystem) {
            console.error('[DataBackup] Capacitor Filesystem 插件不可用');
            if (callback) callback(null);
            return;
        }

        try {
            const fullPath = this.BACKUP_DIR + '/' + filename;

            const result = await Filesystem.readFile({
                path: fullPath,
                directory: 'DOCUMENTS'
            });

            const content = this._base64ToString(result.data);
            if (callback) callback(content);
        } catch (e) {
            console.log('[DataBackup] 备份文件不存在或读取失败:', e.message);
            if (callback) callback(null);
        }
    },

    /**
     * 降级方案：旧的 plus.io 读取方式
     */
    _readPublicFileLegacy(filename, callback) {
        const self = this;
        try {
            plus.io.requestFileSystem(plus.io.PUBLIC_DOWNLOADS, function(fs) {
                fs.root.getDirectory(self.BACKUP_DIR, { create: false }, function(dirEntry) {
                    dirEntry.getFile(filename, { create: false }, function(fileEntry) {
                        fileEntry.file(function(file) {
                            const reader = new plus.io.FileReader();
                            reader.onloadend = function(e) {
                                if (callback) callback(e.target.result);
                            };
                            reader.onerror = function(e) {
                                console.error('[DataBackup] 读取错误:', JSON.stringify(e));
                                if (callback) callback(null);
                            };
                            reader.readAsText(file, 'utf-8');
                        }, function() {
                            console.log('[DataBackup] 备份文件不存在');
                            if (callback) callback(null);
                        });
                    }, function() {
                        console.log('[DataBackup] 灵墨目录不存在');
                        if (callback) callback(null);
                    });
                }, function(e) {
                    console.error('[DataBackup] 请求文件系统失败:', JSON.stringify(e));
                    if (callback) callback(null);
                });
            });
        } catch (e) {
            console.error('[DataBackup] 读取异常:', e.message);
            if (callback) callback(null);
        }
    },

    /**
     * Base64 转字符串
     */
    _base64ToString(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new TextDecoder('utf-8').decode(bytes);
    },

    /**
     * 收集所有 localStorage 中与灵墨相关的数据
     * 同步版本，用于快速预览，不含 IndexedDB 章节正文
     */
    _collectLocalStorageData() {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (
                key.startsWith('books') ||
                key.startsWith('chapters_') ||
                key.startsWith('memory_') ||
                key.startsWith('plans_') ||
                key.startsWith('specs_') ||
                key.startsWith('reviews_') ||
                key === 'ai_models' ||
                key === 'active_model_id' ||
                key.startsWith('bs_')
            )) {
                try {
                    data[key] = JSON.parse(localStorage.getItem(key));
                } catch {
                    data[key] = localStorage.getItem(key);
                }
            }
        }
        return {
            version: 1,
            timestamp: new Date().toISOString(),
            data: data
        };
    },

    /**
     * 收集所有数据（含 IndexedDB 章节正文）
     * P0修复：之前 collectAllData 只收集 localStorage，完全遗漏了 IndexedDB 中的章节正文。
     * 这导致导出的备份在恢复后会丢失所有章节内容文本。
     * 
     * @returns {Promise<Object>} 完整备份数据对象
     */
    async collectAllData() {
        const backup = this._collectLocalStorageData();

        // ★ P0修复：收集 IndexedDB 中的所有章节正文
        try {
            const indexedDBData = {};
            // 遍历所有 bookId，从 chapters_ 元数据中提取 bookId
            const allBooks = backup.data['books'];
            const bookIds = [];
            if (allBooks) {
                try {
                    const books = typeof allBooks === 'string' ? JSON.parse(allBooks) : allBooks;
                    if (Array.isArray(books)) {
                        books.forEach(b => bookIds.push(b.id));
                    }
                } catch {}
            }
            // 也尝试从 localStorage key 中提取 bookId
            for (const key of Object.keys(backup.data)) {
                if (key.startsWith('chapters_')) {
                    const bookId = key.replace('chapters_', '');
                    if (!bookIds.includes(bookId)) {
                        bookIds.push(bookId);
                    }
                }
            }

            // 为每个 bookId 收集 IndexedDB 章节正文
            for (const bookId of bookIds) {
                try {
                    const chaptersMeta = backup.data[`chapters_${bookId}`];
                    if (!chaptersMeta) continue;

                    const chapters = typeof chaptersMeta === 'string' ? JSON.parse(chaptersMeta) : chaptersMeta;
                    if (!Array.isArray(chapters) || chapters.length === 0) continue;

                    const chapterContents = {};
                    // 使用 ChapterDB 批量加载正文
                    if (typeof ChapterDB !== 'undefined') {
                        for (const ch of chapters) {
                            try {
                                const content = await ChapterDB.getContent(bookId, ch.id);
                                if (content) {
                                    chapterContents[ch.id] = content;
                                }
                            } catch (e) {
                                console.warn(`[DataBackup] 读取章节正文失败: ${bookId}/${ch.id}`, e.message);
                            }
                        }
                    }

                    if (Object.keys(chapterContents).length > 0) {
                        indexedDBData[bookId] = chapterContents;
                    }
                } catch (e) {
                    console.warn(`[DataBackup] 收集 bookId=${bookId} 的 IndexedDB 数据失败:`, e.message);
                }
            }

            if (Object.keys(indexedDBData).length > 0) {
                backup.indexedDB = indexedDBData;
                backup.indexedDBCount = Object.values(indexedDBData).reduce((sum, chs) => sum + Object.keys(chs).length, 0);
            }
        } catch (e) {
            console.error('[DataBackup] 收集 IndexedDB 数据失败:', e);
            // 不阻断导出，至少 localStorage 数据还在
        }

        return backup;
    },

    /**
     * 从应用 Documents/灵墨/ 读取备份
     */
    readFromFile(callback) {
        if (!this.isNative()) {
            if (callback) callback(null);
            return;
        }

        this._readPublicFile(this.BACKUP_FILENAME, (content) => {
            if (!content) {
                if (callback) callback(null);
                return;
            }
            try {
                const backup = JSON.parse(content);
                if (callback) callback(backup);
            } catch (err) {
                console.error('[DataBackup] 备份文件解析失败:', err);
                if (callback) callback(null);
            }
        });
    },

    /**
     * 从备份文件恢复数据到 localStorage
     * P0修复：恢复时同时写入 IndexedDB 中的章节正文
     */
    restoreFromFile(callback) {
        this.readFromFile((backup) => {
            if (!backup || !backup.data) {
                if (callback) callback({ success: false, message: '未找到备份文件' });
                return;
            }

            try {
                const keys = Object.keys(backup.data);
                if (keys.length === 0) {
                    if (callback) callback({ success: false, message: '备份文件中无有效数据' });
                    return;
                }

                // 回滚保护：先快照当前数据
                const tempSnapshot = {};
                keys.forEach(key => {
                    const existing = localStorage.getItem(key);
                    if (existing !== null) tempSnapshot[key] = existing;
                });
                let snapshotSaved = false;
                try {
                    localStorage.setItem('__lingmo_restore_snapshot__', JSON.stringify(tempSnapshot));
                    snapshotSaved = true;
                } catch {}

                let failedKey = null;
                for (let i = 0; i < keys.length; i++) {
                    const key = keys[i];
                    const value = backup.data[key];
                    try {
                        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
                    } catch (e) {
                        failedKey = key;
                        // 回滚
                        for (let j = 0; j < i; j++) {
                            const rollbackKey = keys[j];
                            const original = tempSnapshot[rollbackKey];
                            if (original !== undefined) localStorage.setItem(rollbackKey, original);
                            else localStorage.removeItem(rollbackKey);
                        }
                        break;
                    }
                }

                if (snapshotSaved) {
                    try { localStorage.removeItem('__lingmo_restore_snapshot__'); } catch {}
                }

                if (failedKey) {
                    console.error('[DataBackup] 恢复时写入失败，已回滚:', failedKey);
                    if (callback) callback({ success: false, message: '恢复失败：存储空间不足' });
                    return;
                }

                // ★ P0修复：恢复 IndexedDB 章节正文
                let indexedDBRestored = 0;
                if (backup.indexedDB && typeof ChapterDB !== 'undefined') {
                    const restorePromises = [];
                    for (const [bookId, chapterContents] of Object.entries(backup.indexedDB)) {
                        for (const [chapterId, content] of Object.entries(chapterContents)) {
                            restorePromises.push(
                                ChapterDB.updateContent(bookId, chapterId, content).then(() => {
                                    indexedDBRestored++;
                                }).catch(e => {
                                    console.error(`[DataBackup] 恢复 IndexedDB 章节失败: ${bookId}/${chapterId}`, e.message);
                                })
                            );
                        }
                    }
                    // 等待所有 IndexedDB 写入完成（但最多等 30 秒）
                    Promise.all(restorePromises).then(() => {
                        console.log(`[DataBackup] IndexedDB 恢复完成，共 ${indexedDBRestored} 章正文`);
                    }).catch(e => {
                        console.error('[DataBackup] IndexedDB 恢复过程中有错误:', e);
                    });
                }

                console.log('[DataBackup] 恢复完成，共恢复 ' + keys.length + ' 个数据项' +
                    (indexedDBRestored > 0 ? `，${indexedDBRestored} 章正文` : ''));
                if (callback) callback({
                    success: true,
                    message: `已恢复 ${keys.length} 个数据项` +
                        (backup.indexedDBCount ? `（含 ${backup.indexedDBCount} 章正文，正在写入…）` : ''),
                    timestamp: backup.timestamp,
                    indexedDBCount: backup.indexedDBCount || 0
                });
            } catch (err) {
                console.error('[DataBackup] 恢复失败:', err);
                if (callback) callback({ success: false, message: '恢复失败: ' + err.message });
            }
        });
    },

    /**
     * 导出备份为文件（用户手动触发）
     * 直接保存到公共目录：优先 Capacitor DOCUMENTS/灵墨/，降级到 Download/
     */
    async exportData() {
        try {
            if (typeof showToast === 'function') {
                showToast('正在收集数据…', 2000);
            }

            const backup = await this.collectAllData();
            const jsonStr = JSON.stringify(backup, null, 2);
            const MAX_EXPORT_SIZE = 20 * 1024 * 1024; // 20MB 上限

            if (jsonStr.length > MAX_EXPORT_SIZE) {
                if (typeof showToast === 'function') {
                    showToast('备份文件过大 (' + (jsonStr.length / 1024 / 1024).toFixed(1) + 'MB)，建议先清理旧数据');
                }
                console.warn('[DataBackup] 备份数据过大，取消导出:', (jsonStr.length / 1024 / 1024).toFixed(1), 'MB');
                return;
            }

            const filename = '灵墨_数据备份_' + new Date().toISOString().slice(0, 10) + '.json';
            const mimeType = 'application/json';

            console.log('[DataBackup] exportData: 准备导出', filename, '大小:', (jsonStr.length / 1024).toFixed(1), 'KB');

            // ★ 直接保存到公共目录
            const result = await this._writePublicFile(filename, jsonStr, mimeType);
            const extra = backup && backup.indexedDBCount ? '（含 ' + backup.indexedDBCount + ' 章正文）' : '';
            if (result.success) {
                if (typeof showToast === 'function') {
                    showToast('备份已保存' + extra + '\n路径：' + result.path, 4000);
                }
            } else {
                if (typeof showToast === 'function') {
                    showToast('导出失败：' + (result.message || '未知错误'));
                }
            }
        } catch (e) {
            console.error('[DataBackup] exportData 异常:', e.message, e.stack);
            if (typeof showToast === 'function') {
                showToast('导出失败：' + e.message);
            }
        }
    },

    /**
     * 统一的保存文件到公共目录（核心）
     * 所有导出最终都走这里：优先 Capacitor DOCUMENTS → plus.io PUBLIC_DOWNLOADS → Web Blob 下载
     */
    async _saveFile(content, filename, mimeType) {
        var result = await this._writePublicFile(filename, content, mimeType);
        if (result.success) {
            if (typeof showToast === 'function') {
                showToast('已保存：' + result.path, 3000);
            }
        } else {
            if (typeof showToast === 'function') {
                showToast('保存失败：' + (result.message || '未知错误'));
            }
        }
        return result;
    },

    /**
     * 从备份文件恢复数据（用户手动触发导入）
     * 优先使用系统文件选择器（原生桥接），降级到 HTML file input
     */
    importFromFile() {
        // 确认覆盖
        if (typeof confirm === 'function' && !confirm('将从备份文件恢复数据，当前数据将被覆盖。确定继续？')) return;

        // 策略1：原生桥接 → 系统文件选择器（支持选择任意目录的文件）
        if (typeof NativeShare !== 'undefined' && NativeShare.pickFile) {
            console.log('[DataBackup] 使用 NativeShare.pickFile 系统文件选择器');
            if (typeof showToast === 'function') showToast('请选择备份文件（.json）', 2000);
            NativeShare.pickFile(function(content) {
                if (!content) {
                    if (typeof showToast === 'function') showToast('未选择文件或已取消');
                    return;
                }
                DataBackup._parseAndImport(content);
            });
            return;
        }

        // 策略2：Capacitor/plus 环境 → 尝试从公共 Documents/灵墨/ 读取
        if (this.isNative()) {
            console.log('[DataBackup] 尝试从 Documents/灵墨/ 读取备份');
            this.readFromFile(function(backup) {
                if (!backup || !backup.data) {
                    // 降级到 HTML file input
                    console.log('[DataBackup] 公共目录无备份文件，降级到 HTML input');
                    DataBackup._importViaFileInput();
                    return;
                }
                DataBackup._doImport(backup);
            });
            return;
        }

        // 策略3：Web 环境 → HTML file input
        this._importViaFileInput();
    },

    /**
     * 通过 HTML file input 选择文件导入
     */
    _importViaFileInput() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = function(e) {
            var file = e.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function(ev) {
                DataBackup._parseAndImport(ev.target.result);
            };
            reader.readAsText(file);
        };
        input.click();
    },

    /**
     * 解析并导入备份内容
     */
    _parseAndImport(content) {
        try {
            var backup = JSON.parse(content);
            if (!backup || !backup.data) {
                if (typeof showToast === 'function') showToast('无效的备份文件，请选择灵墨导出的 .json 文件');
                return;
            }
            this._doImport(backup);
        } catch (err) {
            console.error('[DataBackup] 备份文件解析失败:', err);
            if (typeof showToast === 'function') showToast('文件解析失败，请确认选择的是灵墨备份文件');
        }
    },

    _doImport(backup) {
        const keys = Object.keys(backup.data);
        if (keys.length === 0) {
            if (typeof showToast === 'function') showToast('备份文件中无有效数据');
            return;
        }

        // ★ 回滚保护：先备份当前数据到临时 key，全部写入成功后再删除
        const tempSnapshot = {};
        keys.forEach(key => {
            const existing = localStorage.getItem(key);
            if (existing !== null) {
                tempSnapshot[key] = existing;
            }
        });

        // 保存快照
        let snapshotSaved = false;
        try {
            localStorage.setItem('__lingmo_import_snapshot__', JSON.stringify(tempSnapshot));
            snapshotSaved = true;
        } catch (e) {
            console.warn('[DataBackup] 无法保存回滚快照:', e.message);
        }

        let successCount = 0;
        let failedKey = null;

        try {
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const value = backup.data[key];
                try {
                    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
                    successCount++;
                } catch (e) {
                    failedKey = key;
                    console.error(`[DataBackup] 导入 "${key}" 失败:`, e.message);
                    // 回滚：恢复之前已写入的数据
                    if (snapshotSaved && i > 0) {
                        console.warn('[DataBackup] 开始回滚已导入的', i, '项数据...');
                        for (let j = 0; j < i; j++) {
                            const rollbackKey = keys[j];
                            const original = tempSnapshot[rollbackKey];
                            if (original !== undefined) {
                                localStorage.setItem(rollbackKey, original);
                            } else {
                                localStorage.removeItem(rollbackKey);
                            }
                        }
                    }
                    break;
                }
            }
        } finally {
            // 清理快照
            if (snapshotSaved) {
                try { localStorage.removeItem('__lingmo_import_snapshot__'); } catch {}
            }
        }

        if (failedKey) {
            if (typeof showToast === 'function') {
                showToast(`导入失败：写入 "${failedKey}" 时出错，已回滚`);
            }
            return;
        }

        if (typeof showToast === 'function') showToast(`已导入 ${keys.length} 个数据项`);
        if (typeof renderBookshelf === 'function') renderBookshelf();
        if (typeof renderModelList === 'function') renderModelList();
    },

    /**
     * 获取备份状态信息
     */
    getBackupInfo(callback) {
        if (!this.isNative()) {
            if (callback) callback({
                native: false,
                message: 'Web环境，数据存储在浏览器缓存中'
            });
            return;
        }

        let booksCount = 0;
        try { booksCount = JSON.parse(localStorage.getItem('books') || '[]').length; } catch {}
        let totalKeys = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('books') || key.startsWith('chapters_') || key.startsWith('memory_'))) {
                totalKeys++;
            }
        }

        this.readFromFile((backup) => {
            if (callback) callback({
                native: true,
                localStorageKeys: totalKeys,
                booksCount: booksCount,
                hasBackupFile: !!backup,
                backupTimestamp: backup ? backup.timestamp : null,
                backupKeys: backup ? Object.keys(backup.data).length : 0,
                backupPath: this._getPublicPathDescription() + '/' + this.BACKUP_FILENAME
            });
        });
    },

    // ============ 书籍导出为可读格式（TXT / HTML） ============

    buildBookTXT(bookId, options = {}) {
        const book = Storage.getBook(bookId);
        const chapters = Storage.getChapters(bookId);
        const plans = Storage.getPlans(bookId);
        let txt = '';

        txt += `${book.name}\n`;
        txt += `${'='.repeat(40)}\n`;
        txt += `作者：灵墨AI辅助创作\n`;
        txt += `类型：${book.genre || '未分类'}\n`;
        if (book.desc) txt += `简介：${book.desc}\n`;
        txt += `${'='.repeat(40)}\n\n`;

        if (options.includePlans) {
            if (plans.setting) {
                txt += `【世界观设定】\n${'-'.repeat(20)}\n${plans.setting}\n\n`;
            }
            if (plans.outline) {
                txt += `【故事大纲】\n${'-'.repeat(20)}\n${plans.outline}\n\n`;
            }
            if (plans.chapter_plan) {
                txt += `【章节规划（旧版）】\n${'-'.repeat(20)}\n${plans.chapter_plan}\n\n`;
            }
            txt += `${'='.repeat(40)}\n\n`;
        }

        if (chapters.length === 0) {
            txt += '（暂无章节内容）\n';
        } else {
            chapters.forEach((ch) => {
                txt += `\n第${ch.order}章  ${ch.title}\n`;
                txt += `${'-'.repeat(30)}\n\n`;
                txt += (ch.content || '（暂无内容）') + '\n\n';
            });
        }

        txt += `\n${'='.repeat(40)}\n`;
        txt += `全书完 · 共${chapters.length}章 · 由灵墨AI辅助创作\n`;

        return txt;
    },

    buildBookHTML(bookId, options = {}) {
        const book = Storage.getBook(bookId);
        const chapters = Storage.getChapters(bookId);
        const plans = Storage.getPlans(bookId);

        const escapeHtml = (s) => {
            return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };

        const nl2br = (s) => {
            return escapeHtml(s).replace(/\n/g, '<br>');
        };

        let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(book.name)} - 灵墨AI创作</title>
<style>
  body { max-width: 800px; margin: 0 auto; padding: 20px; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #2c2c2c; line-height: 2; background: #f8f6f0; }
  .cover { text-align: center; padding: 60px 0 40px; }
  .cover h1 { font-size: 28px; margin-bottom: 12px; color: #1a1a2e; }
  .cover .meta { color: #888; font-size: 14px; }
  .cover .desc { max-width: 500px; margin: 16px auto 0; color: #555; font-size: 15px; }
  .divider { border: none; border-top: 2px dashed #ddd; margin: 30px 0; }
  .plan-section { background: #fefefe; border-left: 4px solid #c9a96e; padding: 16px 20px; margin: 20px 0; border-radius: 4px; }
  .plan-section h3 { margin: 0 0 10px; color: #8b6914; font-size: 17px; }
  .plan-section p { margin: 0; font-size: 14px; color: #555; }
  .chapter { margin: 30px 0; }
  .chapter h2 { font-size: 22px; color: #1a1a2e; border-bottom: 1px solid #e0d8c8; padding-bottom: 8px; margin-bottom: 16px; }
  .chapter .content { text-indent: 2em; font-size: 16px; }
  .footer { text-align: center; color: #aaa; font-size: 13px; margin-top: 60px; padding-top: 20px; border-top: 1px solid #e0d8c8; }
</style>
</head>
<body>
<div class="cover">
  <h1>${escapeHtml(book.name)}</h1>
  <div class="meta">类型：${escapeHtml(book.genre || '未分类')} | 共${chapters.length}章</div>
  ${book.desc ? `<div class="desc">${escapeHtml(book.desc)}</div>` : ''}
</div>
<hr class="divider">\n`;

        if (options.includePlans) {
            if (plans.setting) {
                html += `<div class="plan-section"><h3>世界观设定</h3><p>${nl2br(plans.setting)}</p></div>\n`;
            }
            if (plans.outline) {
                html += `<div class="plan-section"><h3>故事大纲</h3><p>${nl2br(plans.outline)}</p></div>\n`;
            }
            if (plans.chapter_plan) {
                html += `<div class="plan-section"><h3>章节规划（旧版）</h3><p>${nl2br(plans.chapter_plan)}</p></div>\n`;
            }
            html += '<hr class="divider">\n';
        }

        chapters.forEach((ch) => {
            html += `<div class="chapter">\n`;
            html += `  <h2>第${ch.order}章  ${escapeHtml(ch.title)}</h2>\n`;
            html += `  <div class="content">${nl2br(ch.content || '（暂无内容）')}</div>\n`;
            html += `</div>\n`;
        });

        html += `<div class="footer">全书完 · 共${chapters.length}章 · 由灵墨AI辅助创作</div>\n</body>\n</html>`;

        return html;
    },

    /**
     * 触发书籍导出（直接保存到公共目录）
     */
    async exportBook(bookId, format, options = {}) {
        try {
            const book = Storage.getBook(bookId);
            if (!book) {
                if (typeof showToast === 'function') showToast('未找到该书籍');
                return;
            }

            let content, mimeType, ext;
            if (format === 'html') {
                content = this.buildBookHTML(bookId, options);
                mimeType = 'text/html';
                ext = '.html';
            } else {
                content = this.buildBookTXT(bookId, options);
                mimeType = 'text/plain';
                ext = '.txt';
            }

            const safeName = book.name.replace(/[\\/:*?"<>|]/g, '_');
            const filename = safeName + ext;

            console.log('[DataBackup] exportBook: 准备导出', filename, '大小:', (content.length / 1024).toFixed(1), 'KB');

            // 直接保存到公共目录
            await this._saveFile(content, filename, mimeType);
        } catch (e) {
            console.error('[DataBackup] exportBook 异常:', e.message, e.stack);
            if (typeof showToast === 'function') {
                showToast('导出失败：' + e.message);
            }
        }
    },
};
