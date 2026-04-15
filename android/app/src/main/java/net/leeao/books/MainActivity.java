package net.leeao.books;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final String HOME_URL = "https://books.leeao.net/";
    private static final String HOME_HOST = "books.leeao.net";
    private static final String PREFS = "reader";
    private static final String KEY_LAST_URL = "last_url";
    private static final String KEY_LAST_TITLE = "last_title";
    private static final String KEY_BOOKMARKS = "bookmarks";

    private SharedPreferences prefs;
    private WebView webView;
    private ProgressBar progressBar;
    private TextView titleView;
    private LinearLayout searchBar;
    private EditText searchInput;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(10, 10, 15));
        setContentView(root);

        root.addView(createToolbar());

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setVisibility(View.GONE);
        root.addView(progressBar, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(2)
        ));

        searchBar = createSearchBar();
        searchBar.setVisibility(View.GONE);
        root.addView(searchBar);

        webView = new WebView(this);
        root.addView(webView, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1
        ));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.addJavascriptInterface(new ReaderBridge(), "LeeAoReader");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override
            public void onReceivedTitle(WebView view, String title) {
                titleView.setText(trimTitle(title));
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                hideSitePwaWidget();
                injectReadingTracker();
                saveLastUrl(url, view.getTitle());
            }
        });

        String startUrl = prefs.getString(KEY_LAST_URL, HOME_URL);
        webView.loadUrl(startUrl == null || startUrl.isEmpty() ? HOME_URL : startUrl);
    }

    private LinearLayout createToolbar() {
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(6), dp(6), dp(6), dp(6));
        toolbar.setBackgroundColor(Color.rgb(10, 10, 15));

        toolbar.addView(toolbarButton("‹", v -> goBack()));
        toolbar.addView(toolbarButton("首页", v -> webView.loadUrl(HOME_URL)));

        titleView = new TextView(this);
        titleView.setText("大李敖全集");
        titleView.setTextColor(Color.rgb(232, 228, 220));
        titleView.setGravity(Gravity.CENTER);
        titleView.setSingleLine(true);
        toolbar.addView(titleView, new LinearLayout.LayoutParams(0, dp(42), 1));

        toolbar.addView(toolbarButton("收藏", v -> toggleBookmark()));
        toolbar.addView(toolbarButton("书签", v -> showBookmarks()));
        toolbar.addView(toolbarButton("搜索", v -> showSearchBar()));

        return toolbar;
    }

    private LinearLayout createSearchBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(8), dp(6), dp(8), dp(6));
        bar.setBackgroundColor(Color.rgb(22, 22, 31));

        searchInput = new EditText(this);
        searchInput.setSingleLine(true);
        searchInput.setHint("搜索当前页面");
        searchInput.setTextColor(Color.rgb(232, 228, 220));
        searchInput.setHintTextColor(Color.rgb(160, 152, 136));
        bar.addView(searchInput, new LinearLayout.LayoutParams(0, dp(42), 1));

        bar.addView(toolbarButton("查找", v -> findInPage()));
        bar.addView(toolbarButton("下一个", v -> webView.findNext(true)));
        bar.addView(toolbarButton("关闭", v -> hideSearchBar()));

        return bar;
    }

    private Button toolbarButton(String text, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(13);
        button.setTextColor(Color.rgb(232, 228, 220));
        button.setAllCaps(false);
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setMinWidth(0);
        button.setMinHeight(0);
        button.setPadding(dp(8), 0, dp(8), 0);
        button.setOnClickListener(listener);
        button.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                dp(42)
        ));
        return button;
    }

    private boolean handleUrl(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        if ("http".equals(scheme) || "https".equals(scheme)) {
            if (HOME_HOST.equals(uri.getHost())) return false;
            openExternal(uri);
            return true;
        }
        return false;
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, "无法打开链接", Toast.LENGTH_SHORT).show();
        }
    }

    private void showSearchBar() {
        searchBar.setVisibility(View.VISIBLE);
        searchInput.requestFocus();
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.showSoftInput(searchInput, InputMethodManager.SHOW_IMPLICIT);
    }

    private void hideSearchBar() {
        webView.clearMatches();
        searchBar.setVisibility(View.GONE);
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(searchInput.getWindowToken(), 0);
    }

    private void findInPage() {
        String query = searchInput.getText().toString().trim();
        if (query.isEmpty()) {
            Toast.makeText(this, "请输入搜索内容", Toast.LENGTH_SHORT).show();
            return;
        }
        webView.findAllAsync(query);
        webView.findNext(true);
    }

    private void toggleBookmark() {
        String url = webView.getUrl();
        if (url == null || url.isEmpty()) return;
        String normalized = normalizeUrl(url);
        List<Bookmark> bookmarks = readBookmarks();

        for (int i = 0; i < bookmarks.size(); i++) {
            if (normalizeUrl(bookmarks.get(i).url).equals(normalized)) {
                bookmarks.remove(i);
                writeBookmarks(bookmarks);
                Toast.makeText(this, "已取消收藏", Toast.LENGTH_SHORT).show();
                return;
            }
        }

        Bookmark bookmark = new Bookmark();
        bookmark.url = url;
        bookmark.title = trimTitle(webView.getTitle());
        bookmark.scrollY = prefs.getInt(scrollKey(url), 0);
        bookmarks.add(0, bookmark);
        writeBookmarks(bookmarks);
        Toast.makeText(this, "已收藏", Toast.LENGTH_SHORT).show();
    }

    private void showBookmarks() {
        List<Bookmark> bookmarks = readBookmarks();
        if (bookmarks.isEmpty()) {
            Toast.makeText(this, "还没有收藏", Toast.LENGTH_SHORT).show();
            return;
        }

        String[] titles = new String[bookmarks.size()];
        for (int i = 0; i < bookmarks.size(); i++) {
            titles[i] = bookmarks.get(i).title;
        }

        new AlertDialog.Builder(this)
                .setTitle("收藏")
                .setItems(titles, (dialog, which) -> {
                    Bookmark bookmark = bookmarks.get(which);
                    prefs.edit().putInt(scrollKey(bookmark.url), bookmark.scrollY).apply();
                    webView.loadUrl(bookmark.url);
                })
                .setNegativeButton("关闭", null)
                .setNeutralButton("清空收藏", (dialog, which) -> {
                    prefs.edit().remove(KEY_BOOKMARKS).apply();
                    Toast.makeText(this, "收藏已清空", Toast.LENGTH_SHORT).show();
                })
                .show();
    }

    private List<Bookmark> readBookmarks() {
        List<Bookmark> bookmarks = new ArrayList<>();
        String raw = prefs.getString(KEY_BOOKMARKS, "[]");
        try {
            JSONArray array = new JSONArray(raw);
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.getJSONObject(i);
                Bookmark bookmark = new Bookmark();
                bookmark.url = item.optString("url");
                bookmark.title = item.optString("title", bookmark.url);
                bookmark.scrollY = item.optInt("scrollY", 0);
                if (!bookmark.url.isEmpty()) bookmarks.add(bookmark);
            }
        } catch (JSONException ignored) {
            prefs.edit().remove(KEY_BOOKMARKS).apply();
        }
        return bookmarks;
    }

    private void writeBookmarks(List<Bookmark> bookmarks) {
        JSONArray array = new JSONArray();
        for (Bookmark bookmark : bookmarks) {
            JSONObject item = new JSONObject();
            try {
                item.put("url", bookmark.url);
                item.put("title", bookmark.title);
                item.put("scrollY", bookmark.scrollY);
                array.put(item);
            } catch (JSONException ignored) {
            }
        }
        prefs.edit().putString(KEY_BOOKMARKS, array.toString()).apply();
    }

    private void injectReadingTracker() {
        String js = "(function(){"
                + "if(window.__leeaoReaderInstalled)return;"
                + "window.__leeaoReaderInstalled=true;"
                + "function save(){try{LeeAoReader.saveProgress(location.href,document.title,Math.round(window.scrollY||0));}catch(e){}}"
                + "var y=0;try{y=LeeAoReader.getScroll(location.href)||0;}catch(e){}"
                + "if(y>0)setTimeout(function(){window.scrollTo(0,y);},350);"
                + "var t=null;window.addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(save,300);},{passive:true});"
                + "save();"
                + "})();";
        webView.evaluateJavascript(js, null);
    }

    private void hideSitePwaWidget() {
        String js = "(function(){"
                + "var style=document.getElementById('leeao-android-hide-pwa');"
                + "if(!style){style=document.createElement('style');style.id='leeao-android-hide-pwa';"
                + "style.textContent='.leeao-pwa-widget{display:none!important;}';document.head.appendChild(style);}"
                + "function hide(){var el=document.querySelector('.leeao-pwa-widget');if(el)el.style.display='none';}"
                + "hide();setTimeout(hide,500);setTimeout(hide,1500);"
                + "})();";
        webView.evaluateJavascript(js, null);
    }

    private void saveCurrentProgress() {
        if (webView == null) return;
        webView.evaluateJavascript(
                "try{LeeAoReader.saveProgress(location.href,document.title,Math.round(window.scrollY||0));}catch(e){}",
                null
        );
    }

    private void saveLastUrl(String url, String title) {
        if (url == null || url.isEmpty()) return;
        prefs.edit()
                .putString(KEY_LAST_URL, url)
                .putString(KEY_LAST_TITLE, trimTitle(title))
                .apply();
    }

    private void goBack() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            finish();
        }
    }

    @Override
    public void onBackPressed() {
        if (searchBar != null && searchBar.getVisibility() == View.VISIBLE) {
            hideSearchBar();
            return;
        }
        goBack();
    }

    @Override
    protected void onPause() {
        saveCurrentProgress();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    private String trimTitle(String title) {
        if (title == null || title.trim().isEmpty()) return "大李敖全集";
        return title.replace(" - 大李敖全集5.0", "").trim();
    }

    private String normalizeUrl(String url) {
        if (url == null) return "";
        int hashIndex = url.indexOf('#');
        return hashIndex >= 0 ? url.substring(0, hashIndex) : url;
    }

    private String scrollKey(String url) {
        return "scroll:" + normalizeUrl(url);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static class Bookmark {
        String title;
        String url;
        int scrollY;
    }

    private class ReaderBridge {
        @JavascriptInterface
        public void saveProgress(String url, String title, int scrollY) {
            if (url == null || url.isEmpty()) return;
            prefs.edit()
                    .putString(KEY_LAST_URL, url)
                    .putString(KEY_LAST_TITLE, trimTitle(title))
                    .putInt(scrollKey(url), Math.max(0, scrollY))
                    .apply();
        }

        @JavascriptInterface
        public int getScroll(String url) {
            return prefs.getInt(scrollKey(url), 0);
        }
    }
}
