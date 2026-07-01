/**
 * Android 原生桥接脚本 (android-bridge.js)
 * 
 * 基于 YZTurboWebAndroid 的 YouzanJSBridge 协议，提供统一的分享/文件操作接口。
 * 
 * 工作原理：
 * 1. YZTurboWebAndroid 通过 JsHandlerRegistry 注册原生 Handler
 * 2. 前端通过 YouzanJSBridge.call(method, params, callback) 调用原生方法
 * 3. 如果不在原生环境（纯浏览器），自动降级为 Web API
 * 
 * 暴露的全局方法：
 *   NativeShare.shareText(text)          - 分享纯文本
 *   NativeShare.shareFile(title, text, content, filename, mimeType) - 分享文件内容
 *   NativeShare.silentSave(content, filename) - 静默保存
 *   NativeShare.pickFile(callback)       - 打开文件选择器
 *   NativeShare.isNative()              - 是否在原生环境
 *   NativeShare.Bridge                  - 通用 Bridge 协议层
 */

/**
 * ============================================================
 * YZJSBridge — 基于 YouzanJSBridge 的通用桥接层
 * ============================================================
 * 
 * 统一封装 YouzanJSBridge 调用，提供：
 * - 自动等待 Bridge 就绪（YouzanJSBridgeReady 事件）
 * - 超时处理（默认 10s）
 * - 降级方案（纯浏览器环境）
 */
var YZJSBridge = (function() {
    var _isReady = false;
    var _pendingCalls = [];
    var DEFAULT_TIMEOUT = 10000;

    // 监听 Bridge 就绪
    if (typeof document !== 'undefined') {
        document.addEventListener('YouzanJSBridgeReady', function() {
            _isReady = true;
            // 处理等待中的调用
            _pendingCalls.forEach(function(item) {
                _doCall(item.method, item.params, item.callback, item.timeout);
            });
            _pendingCalls = [];
        }, false);
    }

    /**
     * 检查是否在原生环境（YouzanJSBridge 可用）
     */
    function isNative() {
        return _isReady || (typeof window.YouzanJSBridge !== 'undefined' && window.YouzanJSBridge !== null);
    }

    /**
     * 调用原生方法
     * @param {string} method   - 原生方法名（对应 IJsCallNativeHandler.method()）
     * @param {object} params   - 参数对象
     * @param {function} callback - 回调 (err, result)
     * @param {number} timeout  - 超时毫秒数
     */
    function call(method, params, callback, timeout) {
        if (!isNative()) {
            // Bridge 还没就绪，加入等待队列
            if (!_isReady) {
                _pendingCalls.push({ method: method, params: params, callback: callback, timeout: timeout });
                console.log('[YZJSBridge] Bridge未就绪，加入等待队列: ' + method);
                return;
            }
            if (callback) callback(new Error('非原生环境'), null);
            return;
        }

        _doCall(method, params, callback, timeout);
    }

    function _doCall(method, params, callback, timeout) {
        var ttl = timeout || DEFAULT_TIMEOUT;
        var called = false;

        var timer = setTimeout(function() {
            if (!called) {
                called = true;
                if (callback) callback(new Error('Bridge 调用超时: ' + method), null);
            }
        }, ttl);

        try {
            window.YouzanJSBridge.call(method, params || {}, function(result) {
                if (!called) {
                    called = true;
                    clearTimeout(timer);
                    if (callback) callback(null, result);
                }
            });
        } catch (e) {
            if (!called) {
                called = true;
                clearTimeout(timer);
                if (callback) callback(e, null);
            }
        }
    }

    /**
     * 同步调用原生方法（不等待回调）
     */
    function callSync(method, params) {
        if (!isNative()) {
            console.warn('[YZJSBridge] callSync 仅在原生环境可用: ' + method);
            return;
        }
        try {
            window.YouzanJSBridge.call(method, params || {}, function() {});
        } catch (e) {
            console.error('[YZJSBridge] callSync 失败:', e);
        }
    }

    /**
     * 监听原生事件
     */
    function on(event, handler) {
        if (isNative()) {
            try {
                window.YouzanJSBridge.on(event, handler);
            } catch (e) {
                console.error('[YZJSBridge] 事件监听失败:', event, e);
            }
        }
    }

    return {
        call: call,
        callSync: callSync,
        on: on,
        isNative: isNative
    };
})();

/**
 * ============================================================
 * NativeShare — 分享/文件操作桥接
 * ============================================================
 * 
 * 基于 YZJSBridge 的分享封装，暴露与旧代码兼容的 API。
 */
var NativeShare = (function() {

    // ============ 速率限制与安全常量 ============
    var _lastShareTime = 0;
    var SHARE_COOLDOWN_MS = 500;

    /**
     * 检测是否在原生环境中
     * 检测优先级：
     * 1. YouzanJSBridge（YZTurboWebAndroid 协议）
     * 2. window.AndroidShare（addJavascriptInterface 注入）
     */
    function isNative() {
        if (YZJSBridge.isNative()) return true;
        // ★ 检测 addJavascriptInterface 注入的 AndroidShare
        try {
            if (typeof window.AndroidShare !== 'undefined' && window.AndroidShare !== null) {
                return true;
            }
        } catch (e) {}
        return false;
    }

    /**
     * 分享纯文本内容
     */
    function shareText(text) {
        if (!text) {
            console.warn('[NativeShare] shareText: 内容为空');
            return;
        }

        if (YZJSBridge.isNative()) {
            YZJSBridge.callSync('shareText', { text: text });
            console.log('[NativeShare] YouzanJSBridge 文本分享已触发');
        } else if (typeof window.AndroidShare !== 'undefined' && window.AndroidShare !== null) {
            try {
                window.AndroidShare.shareText(text);
                console.log('[NativeShare] AndroidShare 文本分享已触发');
            } catch (e) {
                console.warn('[NativeShare] AndroidShare.shareText 失败:', e.message);
                _webFallbackShareText(text);
            }
        } else {
            _webFallbackShareText(text);
        }
    }

    /**
     * 分享文件内容（通过 Base64 传输）
     */
    function shareFile(title, text, content, filename, mimeType) {
        if (!content) {
            console.warn('[NativeShare] shareFile: 内容为空');
            return;
        }

        // 速率限制
        var now = Date.now();
        if (now - _lastShareTime < SHARE_COOLDOWN_MS) {
            console.warn('[NativeShare] shareFile: 调用过于频繁，已忽略');
            return;
        }
        _lastShareTime = now;

        // 编码为 Base64
        var contentWithBom = '\uFEFF' + content;
        var base64 = _stringToBase64(contentWithBom);

        if (YZJSBridge.isNative()) {
            // 优先通过 YouzanJSBridge 调用原生分享 Handler
            YZJSBridge.call('shareFile', {
                title: title || '分享文件',
                text: text || '',
                base64Data: base64,
                filename: filename || 'share.txt',
                mimeType: mimeType || 'text/plain'
            }, function(err, result) {
                if (err) {
                    console.error('[NativeShare] YouzanJSBridge 文件分享失败:', err);
                } else {
                    console.log('[NativeShare] YouzanJSBridge 文件分享成功');
                }
            });
        } else if (typeof window.AndroidShare !== 'undefined' && window.AndroidShare !== null) {
            // ★ addJavascriptInterface 注入的 AndroidShare（最简桥接）
            try {
                console.log('[NativeShare] 使用 window.AndroidShare.saveAndShare（文件分享）');
                // ★ 修复：使用 saveAndShare 而非 shareFile
                // saveAndShare 通过 FileProvider 以 EXTRA_STREAM 方式分享真正的文件
                // shareFile 只是纯文本分享(EXTRA_TEXT)，大内容会被截断
                window.AndroidShare.saveAndShare(
                    title || '分享文件',
                    text || '',
                    base64,
                    filename || 'share.txt',
                    mimeType || 'text/plain'
                );
            } catch (e) {
                console.error('[NativeShare] window.AndroidShare.saveAndShare 失败:', e.message);
                // 降级：尝试 shareFile（纯文本分享）
                try {
                    console.log('[NativeShare] 降级使用 window.AndroidShare.shareFile（纯文本分享）');
                    window.AndroidShare.shareFile(
                        title || '分享文件',
                        text || '',
                        base64,
                        mimeType || 'text/plain'
                    );
                } catch (e2) {
                    console.error('[NativeShare] window.AndroidShare.shareFile 也失败:', e2.message);
                    _webShareOrSaveFile(content, filename, mimeType);
                }
            }
        } else {
            // Web 环境降级
            _webShareOrSaveFile(content, filename, mimeType);
        }
    }

    /**
     * 静默保存文件（不弹出分享面板）
     */
    function silentSave(content, filename) {
        if (!content || !isNative()) return;
        try {
            var contentWithBom = '\uFEFF' + content;
            var base64 = _stringToBase64(contentWithBom);
            if (YZJSBridge.isNative()) {
                YZJSBridge.callSync('silentSave', {
                    base64Data: base64,
                    filename: filename || 'backup.json'
                });
            } else if (typeof window.AndroidShare !== 'undefined' && window.AndroidShare !== null) {
                window.AndroidShare.silentSave(base64, filename || 'backup.json');
            }
            console.log('[NativeShare] 静默保存已触发');
        } catch (e) {
            console.warn('[NativeShare] 静默保存失败:', e.message);
        }
    }

    /**
     * 打开系统文件选择器
     */
    function pickFile(callback) {
        if (!isNative()) {
            console.warn('[NativeShare] pickFile 仅在原生环境可用');
            if (callback) callback(null);
            return;
        }

        var called = false;
        var timer = setTimeout(function() {
            if (!called) {
                called = true;
                console.warn('[NativeShare] pickFile 超时（30秒）');
                if (callback) callback(null);
            }
        }, 30000);

        if (YZJSBridge.isNative()) {
            YZJSBridge.call('pickFile', {}, function(err, result) {
                if (!called) {
                    called = true;
                    clearTimeout(timer);
                    if (callback) {
                        callback(err ? null : (result && result.content ? result.content : null));
                    }
                }
            });
        } else if (typeof window.AndroidShare !== 'undefined' && window.AndroidShare !== null) {
            try {
                // AndroidShare.pickFile() 是 @JavascriptInterface，不支持 JS 回调函数
                // Java 端通过 window.__onFilePicked(content) 返回文件内容
                window.__onFilePicked = function(content) {
                    window.__onFilePicked = null; // 用完即清理
                    if (!called) {
                        called = true;
                        clearTimeout(timer);
                        if (callback) callback(content);
                    }
                };
                window.AndroidShare.pickFile();
            } catch (e) {
                window.__onFilePicked = null;
                clearTimeout(timer);
                console.error('[NativeShare] AndroidShare.pickFile 失败:', e.message);
                if (callback) callback(null);
            }
        }
    }

    // ============ 内部工具函数 ============

    function _stringToBase64(str) {
        try {
            var encoder = new TextEncoder();
            var bytes = encoder.encode(str);
            var binary = '';
            for (var i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return btoa(binary);
        } catch (e) {
            return btoa(unescape(encodeURIComponent(str)));
        }
    }

    // ============ Web 降级方案 ============

    function _webFallbackShareText(text) {
        if (navigator.share && navigator.canShare) {
            var shareData = { text: text };
            if (navigator.canShare(shareData)) {
                navigator.share(shareData).catch(function() {});
                return;
            }
        }
        _webCopyToClipboard(text);
    }

    function _webCopyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function() {
                _webFallbackTextarea(text);
            });
        } else {
            _webFallbackTextarea(text);
        }
    }

    function _webFallbackTextarea(text) {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(textarea);
    }

    function _webShareOrSaveFile(content, filename, mimeType) {
        // 优先 Web Share API（文件分享）
        if (navigator.share && navigator.canShare) {
            var file = new File(['\uFEFF' + content], filename, { type: (mimeType || 'text/plain') + ';charset=utf-8' });
            var shareData = { title: filename, text: '灵墨导出', files: [file] };
            if (navigator.canShare(shareData)) {
                navigator.share(shareData).catch(function() {
                    _trySaveFilePicker(content, filename, mimeType);
                });
                return;
            }
        }
        _trySaveFilePicker(content, filename, mimeType);
    }

    function _trySaveFilePicker(content, filename, mimeType) {
        if (typeof window.showSaveFilePicker === 'function') {
            window.showSaveFilePicker({ suggestedName: filename }).then(function(handle) {
                return handle.createWritable().then(function(writable) {
                    return writable.write('\uFEFF' + content).then(function() {
                        return writable.close();
                    });
                });
            }).catch(function() {
                _webDownloadFile(content, filename, mimeType);
            });
            return;
        }
        _webDownloadFile(content, filename, mimeType);
    }

    function _webDownloadFile(content, filename, mimeType) {
        try {
            var blob = new Blob(['\uFEFF' + content], { type: (mimeType || 'text/plain') + ';charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = filename || 'download.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('[NativeShare] Web下载失败:', e);
        }
    }

    // ============ 公开 API ============

    return {
        isNative: isNative,
        shareText: shareText,
        shareFile: shareFile,
        silentSave: silentSave,
        pickFile: pickFile,
        Bridge: YZJSBridge
    };

})();

/**
 * ============================================================
 * WebViewReady — WebView 环境就绪检测
 * ============================================================
 */
var WebViewReady = (function() {
    var BRIDGE_POLL_INTERVAL = 100;
    var BRIDGE_POLL_TIMEOUT = 5000;  // 增加到5秒，给 YouzanJSBridge 更多时间

    function isNativeReady() {
        return YZJSBridge.isNative();
    }

    function isCapacitorReady() {
        return typeof window.Capacitor !== 'undefined' && 
               typeof window.Capacitor.Plugins !== 'undefined' &&
               typeof window.Capacitor.Plugins.Filesystem !== 'undefined';
    }

    function isReady() {
        return {
            native: isNativeReady(),
            capacitor: isCapacitorReady()
        };
    }

    function waitForBridge(timeout) {
        var ttl = timeout || BRIDGE_POLL_TIMEOUT;
        return new Promise(function(resolve) {
            if (isNativeReady()) {
                resolve({ ready: true, waited: 0 });
                return;
            }

            var startTime = Date.now();
            var timer = setInterval(function() {
                if (isNativeReady()) {
                    clearInterval(timer);
                    resolve({ ready: true, waited: Date.now() - startTime });
                } else if (Date.now() - startTime > ttl) {
                    clearInterval(timer);
                    console.warn('[WebViewReady] Bridge 就绪超时，降级运行');
                    resolve({ ready: false, waited: ttl, reason: 'timeout' });
                }
            }, BRIDGE_POLL_INTERVAL);
        });
    }

    function waitForCapacitor(timeout) {
        var ttl = timeout || BRIDGE_POLL_TIMEOUT;
        return new Promise(function(resolve) {
            if (isCapacitorReady()) {
                resolve({ ready: true, waited: 0 });
                return;
            }
            var startTime = Date.now();
            var timer = setInterval(function() {
                if (isCapacitorReady()) {
                    clearInterval(timer);
                    resolve({ ready: true, waited: Date.now() - startTime });
                } else if (Date.now() - startTime > ttl) {
                    clearInterval(timer);
                    resolve({ ready: false, waited: ttl, reason: 'timeout' });
                }
            }, BRIDGE_POLL_INTERVAL);
        });
    }

    return {
        isNativeReady: isNativeReady,
        isCapacitorReady: isCapacitorReady,
        isReady: isReady,
        waitForBridge: waitForBridge,
        waitForCapacitor: waitForCapacitor
    };
})();
