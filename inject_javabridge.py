#!/usr/bin/env python3
"""
CI 注入脚本：将 ShareJSInterface.java 和修改后的 MainActivity.java
写入 Android 项目的正确位置，并配置 FileProvider。
"""
import os, re, glob

# 1. 查找包路径
def find_package_path():
    # 从 capacitor.config.ts 读取 appId
    config_path = 'capacitor.config.ts'
    if os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            content = f.read()
        m = re.search(r"appId:\s*'([^']+)'", content)
        if m:
            return m.group(1)
    return 'com.app.lingmo'

# 2. 查找 MainActivity.java 所在目录
def find_java_src(package_path):
    pkg_dir = package_path.replace('.', '/')
    expected = f'android/app/src/main/java/{pkg_dir}'
    if os.path.isdir(expected):
        return expected
    # 搜索
    for root, dirs, files in os.walk('android/app/src/main/java'):
        if 'MainActivity.java' in files:
            return root
    # 创建
    os.makedirs(expected, exist_ok=True)
    return expected

# 3. 写入 ShareJSInterface.java
SHARE_JS_INTERFACE_CODE = r"""package com.app.lingmo;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;

/**
 * JavaScript 与 Android 原生交互的桥接类
 *
 * 功能：
 * 1. shareText(text)       - 分享纯文本到微信/QQ/短信等
 * 2. shareFile(title, text, base64Data, mimeType) - 分享文件（Base64编码内容）
 * 3. saveAndShare(title, text, base64Data, filename, mimeType) - 先写临时文件再分享
 *
 * 使用方式（JS端）：
 *   window.AndroidShare.shareText("分享的文字内容");
 *   window.AndroidShare.shareFile("标题", "描述", "base64内容", "text/plain");
 *   window.AndroidShare.saveAndShare("标题", "描述", "base64内容", "文件名.txt", "text/plain");
 */
public class ShareJSInterface {

    private final Context context;

    public ShareJSInterface(Context context) {
        this.context = context;
    }

    /**
     * 分享纯文本内容
     * 调用 Intent.ACTION_SEND 打开系统分享面板
     *
     * @param text JS 传来的文字内容
     */
    @JavascriptInterface
    public void shareText(String text) {
        try {
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType("text/plain");
            shareIntent.putExtra(Intent.EXTRA_TEXT, text);
            shareIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            // Android 强制要求使用 chooser 弹出分享面板
            Intent chooser = Intent.createChooser(shareIntent, "分享到…");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(chooser);

            showToast("已打开分享面板");
        } catch (Exception e) {
            showToast("分享失败: " + e.getMessage());
        }
    }

    /**
     * 分享文件（Base64 编码内容）
     * 将 Base64 数据写入应用缓存目录的临时文件，然后通过 Intent 分享
     *
     * @param title     分享对话框标题
     * @param text      分享描述文本
     * @param base64Data 文件的 Base64 编码内容
     * @param filename  文件名（如 "数据备份.json"）
     * @param mimeType  MIME 类型（如 "application/json", "text/plain"）
     */
    @JavascriptInterface
    public void saveAndShare(String title, String text, String base64Data, String filename, String mimeType) {
        try {
            // 将 Base64 解码并写入缓存目录
            byte[] fileBytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
            java.io.File cacheDir = context.getCacheDir();
            java.io.File shareDir = new java.io.File(cacheDir, "share");
            if (!shareDir.exists()) {
                shareDir.mkdirs();
            }

            // 清理旧文件（可选，避免缓存堆积）
            java.io.File tempFile = new java.io.File(shareDir, filename);
            java.io.FileOutputStream fos = new java.io.FileOutputStream(tempFile);
            fos.write(fileBytes);
            fos.close();

            // 通过 FileProvider 获取 URI
            android.net.Uri fileUri = androidx.core.content.FileProvider.getUriForFile(
                context,
                context.getPackageName() + ".fileprovider",
                tempFile
            );

            // 构建分享 Intent
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType(mimeType != null && !mimeType.isEmpty() ? mimeType : "*/*");
            shareIntent.putExtra(Intent.EXTRA_STREAM, fileUri);
            if (text != null && !text.isEmpty()) {
                shareIntent.putExtra(Intent.EXTRA_TEXT, text);
            }
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            shareIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            Intent chooser = Intent.createChooser(shareIntent, title != null ? title : "分享文件");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(chooser);

            showToast("已打开分享面板，选择应用保存或发送");
        } catch (Exception e) {
            showToast("分享失败: " + e.getMessage());
        }
    }

    /**
     * 便捷方法：分享 Base64 编码的文本文件
     * 不需要 FileProvider，直接作为文本分享
     *
     * @param title     分享标题
     * @param text      分享描述
     * @param base64Data Base64 编码的内容
     * @param mimeType  MIME 类型
     */
    @JavascriptInterface
    public void shareFile(String title, String text, String base64Data, String mimeType) {
        try {
            byte[] decodedBytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
            String content = new String(decodedBytes, "UTF-8");

            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType(mimeType != null && !mimeType.isEmpty() ? mimeType : "text/plain");
            shareIntent.putExtra(Intent.EXTRA_TEXT, content);
            if (title != null && !title.isEmpty()) {
                shareIntent.putExtra(Intent.EXTRA_SUBJECT, title);
            }
            shareIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            Intent chooser = Intent.createChooser(shareIntent, title != null ? title : "分享");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(chooser);

            showToast("已打开分享面板");
        } catch (Exception e) {
            showToast("分享失败: " + e.getMessage());
        }
    }

    /**
     * 静默保存文件到缓存目录（不弹出分享面板，不显示 Toast）
     * 用于自动备份场景
     */
    @JavascriptInterface
    public void silentSave(String base64Data, String filename) {
        try {
            byte[] fileBytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
            java.io.File shareDir = new java.io.File(context.getCacheDir(), "share");
            if (!shareDir.exists()) shareDir.mkdirs();
            java.io.File tempFile = new java.io.File(shareDir, filename);
            java.io.FileOutputStream fos = new java.io.FileOutputStream(tempFile);
            fos.write(fileBytes); fos.close();
        } catch (Exception e) { /* 静默失败 */ }
    }

    /**
     * 打开系统文件选择器，让用户选择 .json 备份文件
     * 选择完成后通过 WebView evaluateJavascript 回调 window.__onFilePicked(content)
     */
    @JavascriptInterface
    public void pickFile() {
        try {
            if (!(context instanceof Activity)) {
                showToast("当前环境不支持文件选择");
                return;
            }
            final Activity activity = (Activity) context;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain"});
            activity.startActivityForResult(intent, 9001);
        } catch (Exception e) {
            showToast("无法打开文件选择器: " + e.getMessage());
        }
    }

    /**
     * 由 MainActivity.onActivityResult 调用，读取选中文件并回调 JS
     */
    public static void handleFileResult(Activity activity, WebView webView, Uri uri) {
        try {
            InputStream is = activity.getContentResolver().openInputStream(uri);
            BufferedReader reader = new BufferedReader(new InputStreamReader(is, "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append("\n");
            }
            reader.close();
            is.close();
            String content = sb.toString();
            String escaped = content.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "");
            final String js = "if(window.__onFilePicked)window.__onFilePicked('" + escaped + "');";
            webView.post(new Runnable() {
                @Override
                public void run() {
                    webView.evaluateJavascript(js, null);
                }
            });
        } catch (Exception e) {
            Toast.makeText(activity, "读取文件失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    /**
     * 显示 Toast 提示（在主线程安全调用）
     */
    private void showToast(final String message) {
        android.os.Handler mainHandler = new android.os.Handler(context.getMainLooper());
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
            }
        });
    }
}
"""

# 4. MainActivity.java 代码（注册 ShareJSInterface + BackStackInterface，处理返回栈和文件选择回调）
MAIN_ACTIVITY_CODE = r"""package com.app.lingmo;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private boolean jsInterfaceRegistered = false;
    private static final int REQUEST_PICK_FILE = 9001;
    private BackStackInterface backStackInterface;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        registerJsInterface();
    }

    private void registerJsInterface() {
        if (jsInterfaceRegistered) return;
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().addJavascriptInterface(
                    new ShareJSInterface(this), "AndroidShare");

                // 注册返回栈管理接口
                backStackInterface = new BackStackInterface();
                getBridge().getWebView().addJavascriptInterface(
                    backStackInterface, "AndroidBackStack");

                jsInterfaceRegistered = true;
                System.out.println("[MainActivity] AndroidShare + AndroidBackStack 注册成功");
            }
        } catch (Exception e) {
            System.err.println("[MainActivity] 注册失败: " + e.getMessage());
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (backStackInterface != null && backStackInterface.getStackCount() > 0) {
                // WebView 内还有页面栈，交给 JS 处理返回
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                        "if(window._handleBackPressed)window._handleBackPressed();", null);
                }
                return true;
            }
            // 栈已空，允许退出
            return super.onKeyDown(keyCode, event);
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_PICK_FILE && resultCode == RESULT_OK && data != null) {
            Uri uri = data.getData();
            if (uri != null && getBridge() != null && getBridge().getWebView() != null) {
                ShareJSInterface.handleFileResult(this, getBridge().getWebView(), uri);
            }
        }
    }
}
"""

# 5. FileProvider 配置
FILE_PROVIDER_XML = '''        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>'''

FILE_PATHS_XML = '''<?xml version="1.0" encoding="utf-8"?>
<paths>
    <cache-path name="share_cache" path="share/" />
</paths>
'''


def main():
    # 确定包路径
    package_path = find_package_path()
    print(f"Package path: {package_path}")

    java_src = find_java_src(package_path)
    print(f"Java source dir: {java_src}")

    # 写入 ShareJSInterface.java（优先使用项目中的文件）
    share_js_path = os.path.join(java_src, 'ShareJSInterface.java')
    copied = False
    for src in ['www/ShareJSInterface.java', 'ShareJSInterface.java']:
        if os.path.exists(src):
            with open(src, 'r', encoding='utf-8') as f:
                code = f.read()
            with open(share_js_path, 'w', encoding='utf-8') as f:
                f.write(code)
            print(f"ShareJSInterface.java 已从 {src} 复制到 {share_js_path}")
            copied = True
            break

    if not copied:
        # 使用内嵌代码，替换 package 声明
        code = SHARE_JS_INTERFACE_CODE.replace('package com.app.lingmo;', f'package {package_path};')
        with open(share_js_path, 'w', encoding='utf-8') as f:
            f.write(code)
        print(f"ShareJSInterface.java 已自动生成到 {share_js_path}")

    # 写入 BackStackInterface.java（优先使用项目中的文件）
    backstack_path = os.path.join(java_src, 'BackStackInterface.java')
    backstack_copied = False
    for src in ['www/BackStackInterface.java', 'BackStackInterface.java']:
        if os.path.exists(src):
            with open(src, 'r', encoding='utf-8') as f:
                code = f.read()
            with open(backstack_path, 'w', encoding='utf-8') as f:
                f.write(code)
            print(f"BackStackInterface.java 已从 {src} 复制到 {backstack_path}")
            backstack_copied = True
            break

    if not backstack_copied:
        print(f"WARNING: BackStackInterface.java 未找到，请确保项目根目录有此文件")

    # 写入 MainActivity.java
    main_activity_path = os.path.join(java_src, 'MainActivity.java')
    code = MAIN_ACTIVITY_CODE.replace('package com.app.lingmo;', f'package {package_path};')
    with open(main_activity_path, 'w', encoding='utf-8') as f:
        f.write(code)
    print(f"MainActivity.java 已写入 {main_activity_path}")

    # 配置 FileProvider
    manifest_path = 'android/app/src/main/AndroidManifest.xml'
    if os.path.exists(manifest_path):
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = f.read()

        # 检查是否已配置 FileProvider
        if 'FileProvider' not in manifest:
            manifest = manifest.replace('</application>', FILE_PROVIDER_XML + '\n    </application>')
            with open(manifest_path, 'w', encoding='utf-8') as f:
                f.write(manifest)
            print("FileProvider 已添加到 AndroidManifest.xml")
        else:
            print("FileProvider 已存在，跳过")
    else:
        print("WARNING: AndroidManifest.xml 不存在")

    # 创建 file_paths.xml
    xml_dir = 'android/app/src/main/res/xml'
    os.makedirs(xml_dir, exist_ok=True)
    file_paths_path = os.path.join(xml_dir, 'file_paths.xml')
    with open(file_paths_path, 'w', encoding='utf-8') as f:
        f.write(FILE_PATHS_XML)
    print(f"file_paths.xml 已创建: {file_paths_path}")

    print("=== 注入完成 ===")


if __name__ == '__main__':
    main()
