package com.app.lingmo;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;

/**
 * 返回栈桥接类
 * 
 * 与 JS 端配合，管理 WebView 内页面层级：
 * - JS 进入子页面时调用 pushStack() → stackCount++
 * - JS 返回上级时调用 popStack() → stackCount--
 * - MainActivity.onBackPressed() 根据 stackCount 决定是否退出
 * 
 * 注册方式（MainActivity 中）：
 *   webView.addJavascriptInterface(new BackStackInterface(), "AndroidBackStack");
 * 
 * JS 端调用：
 *   window.AndroidBackStack.pushStack();  // 进入子页面
 *   window.AndroidBackStack.popStack();   // 返回上一级
 */
public class BackStackInterface {

    private int stackCount = 0;

    /**
     * JS 调用：进入子页面，栈深度+1
     */
    @JavascriptInterface
    public void pushStack() {
        stackCount++;
        android.util.Log.d("BackStack", "pushStack → stackCount=" + stackCount);
    }

    /**
     * JS 调用：返回上一级，栈深度-1
     */
    @JavascriptInterface
    public void popStack() {
        if (stackCount > 0) {
            stackCount--;
        }
        android.util.Log.d("BackStack", "popStack → stackCount=" + stackCount);
    }

    /**
     * JS 调用：重置栈深度（用于跳转到首页等场景）
     */
    @JavascriptInterface
    public void resetStack() {
        stackCount = 0;
        android.util.Log.d("BackStack", "resetStack → stackCount=0");
    }

    /**
     * 获取当前栈深度（供 MainActivity.onBackPressed 使用）
     */
    public int getStackCount() {
        return stackCount;
    }
}
