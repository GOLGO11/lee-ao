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
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
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

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import android.webkit.WebResourceResponse;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

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
    private Button speechButton;
    private TextToSpeech textToSpeech;
    private boolean ttsReady = false;
    private boolean speechActive = false;
    private final List<String> speechChunks = new ArrayList<>();
    private int speechIndex = 0;
    private volatile boolean searchInProgress = false;
    private String activeSearchQuery = null;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        initTextToSpeech();

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
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("https://books.leeao.net/")) {
                    String path = request.getUrl().getPath();
                    if (path == null || path.isEmpty() || path.equals("/")) {
                        path = "/index.html";
                    }
                    File localFile = new File(getFilesDir() + "/offline_data", path);
                    if (localFile.exists()) {
                        try {
                            String mime = "text/html";
                            if (path.endsWith(".css")) mime = "text/css";
                            else if (path.endsWith(".js")) mime = "application/javascript";
                            else if (path.endsWith(".json")) mime = "application/json";
                            else if (path.endsWith(".svg")) mime = "image/svg+xml";
                            else if (path.endsWith(".png")) mime = "image/png";
                            else if (path.endsWith(".txt")) mime = "text/plain";
                            return new WebResourceResponse(mime, "UTF-8", new FileInputStream(localFile));
                        } catch (Exception e) {
                            // ignore, fallback to network
                        }
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                stopReadAloud(null);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                hideSitePwaWidget();
                injectReadingTracker();
                saveLastUrl(url, view.getTitle());
                if (activeSearchQuery != null) {
                    view.findAllAsync(activeSearchQuery);
                    activeSearchQuery = null;
                }
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

        titleView = new TextView(this);
        titleView.setText("大李敖全集");

        toolbar.addView(toolbarButton("返回", v -> goBack()), weightedToolbarParams());
        toolbar.addView(toolbarButton("首页", v -> webView.loadUrl(HOME_URL)), weightedToolbarParams());
        toolbar.addView(toolbarButton("收藏", v -> toggleBookmark()), weightedToolbarParams());
        toolbar.addView(toolbarButton("书签", v -> showBookmarks()), weightedToolbarParams());
        toolbar.addView(toolbarButton("搜索", v -> showSearchBar()), weightedToolbarParams());
        speechButton = toolbarButton("朗读", v -> toggleReadAloud());
        toolbar.addView(speechButton, weightedToolbarParams());

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
        searchInput.setHint("搜索全集");
        searchInput.setTextColor(Color.rgb(232, 228, 220));
        searchInput.setHintTextColor(Color.rgb(160, 152, 136));
        bar.addView(searchInput, new LinearLayout.LayoutParams(0, dp(42), 1));

        bar.addView(toolbarButton("全集", v -> searchWholeSite()));
        bar.addView(toolbarButton("本页", v -> findInPage()));
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
        button.setMinimumWidth(0);
        button.setMinimumHeight(0);
        button.setIncludeFontPadding(false);
        button.setPadding(dp(8), 0, dp(8), 0);
        button.setOnClickListener(listener);
        return button;
    }

    private LinearLayout.LayoutParams weightedToolbarParams() {
        return new LinearLayout.LayoutParams(0, dp(42), 1);
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
        hideKeyboard();
    }

    private void hideKeyboard() {
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(searchInput.getWindowToken(), 0);
    }

    private void initTextToSpeech() {
        textToSpeech = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) {
                Toast.makeText(this, "语音引擎初始化失败", Toast.LENGTH_LONG).show();
                return;
            }

            int languageResult = textToSpeech.setLanguage(Locale.SIMPLIFIED_CHINESE);
            if (languageResult == TextToSpeech.LANG_MISSING_DATA
                    || languageResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                textToSpeech.setLanguage(Locale.CHINESE);
            }
            textToSpeech.setSpeechRate(0.92f);
            textToSpeech.setPitch(1.0f);
            textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String utteranceId) {
                }

                @Override
                public void onDone(String utteranceId) {
                    runOnUiThread(() -> {
                        if (speechActive) speakNextSpeechChunk();
                    });
                }

                @Override
                public void onError(String utteranceId) {
                    runOnUiThread(() -> stopReadAloud("朗读中断"));
                }
            });
            ttsReady = true;
        });
    }

    private void toggleReadAloud() {
        if (speechActive) {
            stopReadAloud("已停止朗读");
            return;
        }
        startReadAloud();
    }

    private void startReadAloud() {
        if (!ttsReady || textToSpeech == null) {
            Toast.makeText(this, "语音引擎还在准备中，请稍后再试", Toast.LENGTH_SHORT).show();
            return;
        }

        saveCurrentProgress();
        if (speechButton != null) speechButton.setText("准备");
        webView.evaluateJavascript(readingTextScript(), value -> {
            String text = decodeJavascriptString(value).trim();
            List<String> chunks = splitSpeechText(text);
            if (chunks.isEmpty()) {
                if (speechButton != null) speechButton.setText("朗读");
                Toast.makeText(this, "当前页面没有可朗读的正文", Toast.LENGTH_SHORT).show();
                return;
            }

            speechChunks.clear();
            speechChunks.addAll(chunks);
            speechIndex = 0;
            speechActive = true;
            if (speechButton != null) speechButton.setText("停止");
            Toast.makeText(this, "开始朗读，可再次点击停止", Toast.LENGTH_SHORT).show();
            speakNextSpeechChunk();
        });
    }

    private void speakNextSpeechChunk() {
        if (!speechActive || textToSpeech == null) return;
        if (speechIndex >= speechChunks.size()) {
            stopReadAloud(null);
            Toast.makeText(this, "朗读完成", Toast.LENGTH_SHORT).show();
            return;
        }

        String chunk = speechChunks.get(speechIndex);
        speechIndex += 1;
        Bundle params = new Bundle();
        textToSpeech.speak(chunk, TextToSpeech.QUEUE_FLUSH, params, "leeao-" + speechIndex);
    }

    private void stopReadAloud(String message) {
        speechActive = false;
        speechChunks.clear();
        speechIndex = 0;
        if (textToSpeech != null) textToSpeech.stop();
        if (speechButton != null) speechButton.setText("朗读");
        if (message != null) Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private String readingTextScript() {
        return "(function(){"
                + "function textOf(el){return (el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim();}"
                + "var root=document.querySelector('main')||document.querySelector('.content')||document.body;"
                + "var nodes=Array.prototype.slice.call(root.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,td,th,pre'));"
                + "var picked=[];"
                + "for(var i=0;i<nodes.length;i++){"
                + "var el=nodes[i];"
                + "var tag=(el.tagName||'').toLowerCase();"
                + "if(el.closest('nav,script,style,button,.nav-chapters,.mobile-nav-chapters,.menu-bar,.chapter'))continue;"
                + "var rect=el.getBoundingClientRect();"
                + "if(rect.bottom<-20)continue;"
                + "var text=textOf(el);"
                + "if(text.length<2)continue;"
                + "if((tag==='td'||tag==='th')&&text.length<8)continue;"
                + "picked.push(text);"
                + "}"
                + "if(!picked.length)picked=[textOf(root)];"
                + "return picked.join('\\n');"
                + "})();";
    }

    private String decodeJavascriptString(String value) {
        if (value == null || "null".equals(value)) return "";
        try {
            return new JSONArray("[" + value + "]").getString(0);
        } catch (JSONException ignored) {
            return value;
        }
    }

    private List<String> splitSpeechText(String text) {
        List<String> chunks = new ArrayList<>();
        String normalized = text.replaceAll("\\s+", " ").trim();
        if (normalized.isEmpty()) return chunks;

        String[] sentences = normalized.split("(?<=[。！？!?；;])");
        StringBuilder current = new StringBuilder();
        for (String sentence : sentences) {
            String part = sentence.trim();
            if (part.isEmpty()) continue;
            if (part.length() > 900) {
                if (current.length() > 0) {
                    chunks.add(current.toString());
                    current.setLength(0);
                }
                splitLongSpeechPart(part, chunks);
                continue;
            }
            if (current.length() + part.length() > 900) {
                chunks.add(current.toString());
                current.setLength(0);
            }
            current.append(part);
        }
        if (current.length() > 0) chunks.add(current.toString());
        return chunks;
    }

    private void splitLongSpeechPart(String text, List<String> chunks) {
        int start = 0;
        while (start < text.length()) {
            int end = Math.min(text.length(), start + 900);
            chunks.add(text.substring(start, end));
            start = end;
        }
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

    private void searchWholeSite() {
        String query = searchInput.getText().toString().trim();
        if (query.isEmpty()) {
            Toast.makeText(this, "请输入搜索内容", Toast.LENGTH_SHORT).show();
            return;
        }
        if (searchInProgress) {
            Toast.makeText(this, "正在搜索，请稍候", Toast.LENGTH_SHORT).show();
            return;
        }

        hideKeyboard();
        searchInProgress = true;
        progressBar.setProgress(0);
        progressBar.setVisibility(View.VISIBLE);

        new Thread(() -> {
            List<SearchResult> results = new ArrayList<>();
            int searched = 0;
            int total = 0;

            try {
                JSONObject manifest = new JSONObject(fetchText(new URL(new URL(HOME_URL), "search/manifest.json")));
                JSONArray docs = manifest.getJSONArray("docs");
                total = docs.length();
                String needle = query.toLowerCase(Locale.ROOT);

                for (int i = 0; i < docs.length() && results.size() < 80; i++) {
                    JSONObject doc = docs.getJSONObject(i);
                    searched += 1;

                    String title = doc.optString("title");
                    String docUrl = doc.optString("url");
                    String textPath = doc.optString("text");
                    String lowerTitle = title.toLowerCase(Locale.ROOT);
                    boolean titleMatch = lowerTitle.contains(needle);

                    String content = "";
                    int contentIndex = -1;
                    if (!textPath.isEmpty() && (!titleMatch || results.size() < 20)) {
                        content = fetchText(new URL(new URL(HOME_URL), textPath));
                        contentIndex = content.toLowerCase(Locale.ROOT).indexOf(needle);
                    }

                    if (titleMatch || contentIndex >= 0) {
                        SearchResult result = new SearchResult();
                        result.title = title.isEmpty() ? docUrl : title;
                        result.url = new URL(new URL(HOME_URL), docUrl).toString();
                        result.snippet = contentIndex >= 0
                                ? makeSnippet(content, contentIndex, query.length())
                                : "标题匹配";
                        results.add(result);
                    }

                    if (searched % 5 == 0 || searched == total) {
                        int currentProgress = (searched * 100) / total;
                        runOnUiThread(() -> progressBar.setProgress(currentProgress));
                    }
                }

                int finalSearched = searched;
                int finalTotal = total;
                runOnUiThread(() -> showSearchResults(query, results, finalSearched, finalTotal));
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(
                        this,
                        "搜索失败，请确认网络可用",
                        Toast.LENGTH_LONG
                ).show());
            } finally {
                searchInProgress = false;
                runOnUiThread(() -> progressBar.setVisibility(View.GONE));
            }
        }).start();
    }

    private volatile boolean downloadInProgress = false;

    private void downloadOfflineData() {
        if (downloadInProgress) {
            Toast.makeText(this, "离线下载正在进行中", Toast.LENGTH_SHORT).show();
            return;
        }

        new AlertDialog.Builder(this)
                .setTitle("离线全集选项")
                .setMessage("请选择离线模式：\n\n【增量/断点模式】仅下载尚未下载的内容，速度最快。\n\n【强制全量更新】无视本地已有文件，重新拉取所有内容（用于网页内容有更新时覆盖）。")
                .setPositiveButton("增量/断点续传", (dialog, which) -> executeDownload(false))
                .setNeutralButton("强制全量更新", (dialog, which) -> executeDownload(true))
                .setNegativeButton("取消", null)
                .show();
    }

    private void executeDownload(boolean forceUpdate) {
        downloadInProgress = true;
        progressBar.setProgress(0);
        progressBar.setVisibility(View.VISIBLE);
        titleView.setText("准备下载" + (forceUpdate ? "(强制)" : "") + "...");

        new Thread(() -> {
            try {
                File baseDir = new File(getFilesDir(), "offline_data");
                if (!baseDir.exists()) baseDir.mkdirs();

                File manifestFile = new File(baseDir, "search/manifest.json");
                if (forceUpdate || !manifestFile.exists() || manifestFile.length() == 0) {
                    downloadFile(new URL(HOME_URL + "search/manifest.json"), manifestFile);
                }

                String manifestText = fetchText(new URL(HOME_URL + "search/manifest.json"));
                JSONObject manifest = new JSONObject(manifestText);
                JSONArray docs = manifest.getJSONArray("docs");

                List<String[]> downloadList = new ArrayList<>();
                
                downloadList.add(new String[]{"index.html", "index.html"});
                downloadList.add(new String[]{"css/variables.css", "css/variables.css"});
                downloadList.add(new String[]{"css/general.css", "css/general.css"});
                downloadList.add(new String[]{"css/chrome.css", "css/chrome.css"});
                downloadList.add(new String[]{"favicon.svg", "favicon.svg"});
                downloadList.add(new String[]{"favicon.png", "favicon.png"});
                downloadList.add(new String[]{"clipboard.min.js", "clipboard.min.js"});
                downloadList.add(new String[]{"highlight.js", "highlight.js"});
                downloadList.add(new String[]{"book.js", "book.js"});
                downloadList.add(new String[]{"elasticlunr.min.js", "elasticlunr.min.js"});
                downloadList.add(new String[]{"mark.min.js", "mark.min.js"});
                downloadList.add(new String[]{"searcher.js", "searcher.js"});

                for (int i = 0; i < docs.length(); i++) {
                    JSONObject doc = docs.getJSONObject(i);
                    String destUrl = doc.optString("url");
                    if (destUrl != null && !destUrl.isEmpty()) {
                        String decodedPath = java.net.URLDecoder.decode(destUrl, "UTF-8");
                        downloadList.add(new String[]{destUrl, decodedPath});
                    }
                    String destText = doc.optString("text");
                    if (destText != null && !destText.isEmpty()) {
                        downloadList.add(new String[]{destText, destText});
                    }
                }

                int total = downloadList.size();
                AtomicInteger completed = new AtomicInteger(0);
                ExecutorService executor = Executors.newFixedThreadPool(8);

                for (String[] pair : downloadList) {
                    executor.submit(() -> {
                        try {
                            String dlPath = pair[0];
                            String localPath = pair[1].startsWith("/") ? pair[1].substring(1) : pair[1];
                            File f = new File(baseDir, localPath);
                            if (forceUpdate || !f.exists() || f.length() == 0) {
                                downloadFile(new URL(HOME_URL + dlPath), f);
                            }
                        } catch (Exception e) {
                            // ignore failures, retry next time
                        } finally {
                            int c = completed.incrementAndGet();
                            if (c % 10 == 0 || c == total) {
                                int progress = (c * 100) / total;
                                runOnUiThread(() -> {
                                    progressBar.setProgress(progress);
                                    titleView.setText("离线: " + c + "/" + total);
                                });
                            }
                        }
                    });
                }

                executor.shutdown();
                while (!executor.isTerminated()) {
                    Thread.sleep(500);
                }

                runOnUiThread(() -> {
                    Toast.makeText(this, "离线下载完成！", Toast.LENGTH_LONG).show();
                    titleView.setText(trimTitle(webView.getTitle()));
                });

            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(this, "离线下载失败：" + e.getMessage(), Toast.LENGTH_LONG).show());
            } finally {
                downloadInProgress = false;
                runOnUiThread(() -> progressBar.setVisibility(View.GONE));
            }
        }).start();
    }

    private void downloadFile(URL url, File dest) throws IOException {
        dest.getParentFile().mkdirs();
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        try (InputStream in = connection.getInputStream();
             FileOutputStream out = new FileOutputStream(dest)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        } finally {
            connection.disconnect();
        }
    }

    private void showSearchResults(String query, List<SearchResult> results, int searched, int total) {
        if (results.isEmpty()) {
            Toast.makeText(this, "没有找到：" + query, Toast.LENGTH_LONG).show();
            return;
        }

        String[] items = new String[results.size()];
        for (int i = 0; i < results.size(); i++) {
            SearchResult result = results.get(i);
            items[i] = result.title + "\n" + result.snippet;
        }

        new AlertDialog.Builder(this)
                .setTitle("搜索 \"" + query + "\" (找到 " + results.size() + " 条)")
                .setItems(items, (dialog, which) -> {
                    activeSearchQuery = query;
                    webView.loadUrl(results.get(which).url);
                })
                .setNegativeButton("关闭", null)
                .show();
    }

    private String fetchText(URL url) throws IOException {
        String urlString = url.toString();
        if (urlString.startsWith("https://books.leeao.net/")) {
            String path = url.getPath();
            File localFile = new File(getFilesDir() + "/offline_data", path);
            if (localFile.exists()) {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                        new FileInputStream(localFile), StandardCharsets.UTF_8))) {
                    StringBuilder builder = new StringBuilder();
                    char[] buffer = new char[8192];
                    int read;
                    while ((read = reader.read(buffer)) != -1) {
                        builder.append(buffer, 0, read);
                    }
                    return builder.toString();
                }
            }
        }

        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("Accept", "application/json,text/plain,*/*");

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                connection.getInputStream(),
                StandardCharsets.UTF_8
        ))) {
            StringBuilder builder = new StringBuilder();
            char[] buffer = new char[8192];
            int read;
            while ((read = reader.read(buffer)) != -1) {
                builder.append(buffer, 0, read);
            }
            return builder.toString();
        } finally {
            connection.disconnect();
        }
    }

    private String makeSnippet(String content, int index, int queryLength) {
        int start = Math.max(0, index - 42);
        int end = Math.min(content.length(), index + Math.max(queryLength, 1) + 70);
        String snippet = content.substring(start, end).replaceAll("\\s+", " ").trim();
        if (start > 0) snippet = "..." + snippet;
        if (end < content.length()) snippet = snippet + "...";
        return snippet;
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

        LinearLayout listLayout = new LinearLayout(this);
        listLayout.setOrientation(LinearLayout.VERTICAL);
        listLayout.setPadding(dp(16), dp(16), dp(16), dp(16));

        android.widget.ScrollView scrollView = new android.widget.ScrollView(this);
        scrollView.addView(listLayout);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("收藏")
                .setView(scrollView)
                .setNegativeButton("关闭", null)
                .setNeutralButton("清空收藏", (d, which) -> {
                    prefs.edit().remove(KEY_BOOKMARKS).apply();
                    Toast.makeText(this, "收藏已清空", Toast.LENGTH_SHORT).show();
                })
                .create();

        for (int i = 0; i < bookmarks.size(); i++) {
            Bookmark bookmark = bookmarks.get(i);

            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(0, dp(8), 0, dp(8));

            TextView titleText = new TextView(this);
            titleText.setText(bookmark.title);
            titleText.setTextSize(16);
            titleText.setEllipsize(android.text.TextUtils.TruncateAt.END);
            titleText.setSingleLine(true);
            LinearLayout.LayoutParams textParams = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
            row.addView(titleText, textParams);

            Button openBtn = new Button(this);
            openBtn.setText("打开");
            openBtn.setOnClickListener(v -> {
                prefs.edit().putInt(scrollKey(bookmark.url), bookmark.scrollY).apply();
                webView.loadUrl(bookmark.url);
                dialog.dismiss();
            });
            row.addView(openBtn, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));

            Button deleteBtn = new Button(this);
            deleteBtn.setText("删除");
            deleteBtn.setOnClickListener(v -> {
                bookmarks.remove(bookmark);
                writeBookmarks(bookmarks);
                listLayout.removeView(row);
                if (bookmarks.isEmpty()) {
                    dialog.dismiss();
                    Toast.makeText(this, "收藏已清空", Toast.LENGTH_SHORT).show();
                }
            });
            row.addView(deleteBtn, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));

            listLayout.addView(row);
        }

        dialog.show();
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
        stopReadAloud(null);
        if (textToSpeech != null) {
            textToSpeech.shutdown();
            textToSpeech = null;
        }
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

    private static class SearchResult {
        String title;
        String url;
        String snippet;
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
