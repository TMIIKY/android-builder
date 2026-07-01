package com.app.lingmo;

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
     * 分享 Base64 编码的文本文件（降级方案：纯文本分享）
     * 不需要 FileProvider，直接作为文本通过 EXTRA_TEXT 分享
     * 注意：大内容可能被截断，推荐使用 saveAndShare 进行真正的文件分享
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
            // ★ 修复：使用 text/plain 确保微信等应用能识别
            // 如果传入的 mimeType 不是有效的 MIME 类型（比如被错误地传入了文件名），使用 text/plain 兜底
            String safeMime = (mimeType != null && !mimeType.isEmpty() && mimeType.contains("/")) 
                ? mimeType : "text/plain";
            shareIntent.setType(safeMime);
            shareIntent.putExtra(Intent.EXTRA_TEXT, content);
            if (title != null && !title.isEmpty()) {
                shareIntent.putExtra(Intent.EXTRA_SUBJECT, title);
            }
            shareIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            Intent chooser = Intent.createChooser(shareIntent, title != null ? title : "分享");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(chooser);

            showToast("已打开分享面板（纯文本模式）");
        } catch (Exception e) {
            showToast("分享失败: " + e.getMessage());
        }
    }

    /**
     * 静默保存文件到缓存目录（不弹出分享面板，不显示 Toast）
     * 用于自动备份场景
     *
     * @param base64Data 文件的 Base64 编码内容
     * @param filename   文件名
     */
    @JavascriptInterface
    public void silentSave(String base64Data, String filename) {
        try {
            byte[] fileBytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
            java.io.File shareDir = new java.io.File(context.getCacheDir(), "share");
            if (!shareDir.exists()) {
                shareDir.mkdirs();
            }
            java.io.File tempFile = new java.io.File(shareDir, filename);
            java.io.FileOutputStream fos = new java.io.FileOutputStream(tempFile);
            fos.write(fileBytes);
            fos.close();
            // 不弹 Toast，不弹分享面板
        } catch (Exception e) {
            // 静默失败，不影响用户体验
        }
    }

    /**
     * 打开系统文件选择器，让用户选择 .json 备份文件
     * 选择完成后自动读取内容并通过 evaluateJavascript 回调给 JS 的 window.__onFilePicked(content)
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
            intent.setType("application/json");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "*/*"});
            // 使用 startActivityForResult，在 MainActivity 中处理结果
            activity.startActivityForResult(intent, 9001);
        } catch (Exception e) {
            showToast("无法打开文件选择器: " + e.getMessage());
        }
    }

    /**
     * 由 MainActivity.onActivityResult 调用，读取选中的文件并通过 WebView 回调给 JS
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
            // 通过 WebView 回调 JS（需要转义特殊字符）
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
