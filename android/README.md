# Android APK

这是 `books.leeao.net` 的轻量 Android 包壳。它使用系统 WebView 打开线上 mdBook，同时在本地提供：

- 自动恢复上次阅读位置
- 收藏当前页面
- 收藏列表跳转
- 全站搜索
- 当前页面内搜索

GitHub Actions 会在 `android/**` 变更或手动触发时构建 debug APK，产物在 workflow artifact 里下载。
