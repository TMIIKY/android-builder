// ========== MainActivity.java 需要添加/修改的代码 ==========
// 
// 请将以下代码整合到你现有的 MainActivity.java 中。
// 关键修改点：
//   1. 声明 BackStackInterface 成员变量
//   2. 在 WebView 初始化处注册 JavascriptInterface
//   3. 重写 onBackPressed()

// ==================== 1. 声明成员变量 ====================
// 在 MainActivity 类体中添加：
private BackStackInterface backStack;

// ==================== 2. 注册 JavascriptInterface ====================
// 在 WebView 初始化代码中（setupWebView 或类似方法），紧挨着其他 addJavascriptInterface 调用：
backStack = new BackStackInterface();
webView.addJavascriptInterface(backStack, "AndroidBackStack");

// 完整示例（假设你已有 ShareJSInterface 注册）：
// ShareJSInterface shareInterface = new ShareJSInterface(this);
// webView.addJavascriptInterface(shareInterface, "AndroidShare");
// backStack = new BackStackInterface();                       // ← 新增
// webView.addJavascriptInterface(backStack, "AndroidBackStack"); // ← 新增

// ==================== 3. 重写 onBackPressed() ====================
@Override
public void onBackPressed() {
    if (backStack != null && backStack.getStackCount() > 0) {
        // 有子页面层级：通知 JS 执行返回逻辑，同时减少栈深度
        runOnUiThread(() -> {
            webView.evaluateJavascript("if(window._handleBackPressed)window._handleBackPressed();", null);
        });
        // 注意：stackCount 由 JS 端在 _handleBackPressed 中调用 popStack() 来减少
        // 这样确保 JS 端和原生端状态一致
    } else {
        // 已经在最外层，退出应用
        super.onBackPressed();
    }
}
