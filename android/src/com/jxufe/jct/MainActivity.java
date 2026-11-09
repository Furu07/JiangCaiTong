package com.jxufe.jct;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;

public class MainActivity extends Activity {
    private static final String ORIGIN = "https://app.local";
    private WebView web;
    private NativeBridge bridge;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Store.sweep(this);
        web = new WebView(this);
        setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSaveFormData(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " JiangCaiTong/0.2.0");
        bridge = new NativeBridge(web);
        web.addJavascriptInterface(bridge, "Android");
        web.setWebViewClient(new AssetClient());
        applySystemBars();
        Store.trimWebViewCache(this, web);
        web.loadUrl(ORIGIN + "/index.html");
    }

    private final class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            String path = url.getPath();
            if (!request.isForMainFrame() && NativeBridge.isWaterCaptcha(url)) return null;
            if (!isLocal(url) || path == null || !path.matches("/[a-zA-Z0-9._-]+")) {
                return blocked();
            }
            String mime = path.endsWith(".js") ? "application/javascript"
                    : path.endsWith(".css") ? "text/css" : "text/html";
            try {
                return new WebResourceResponse(mime, "UTF-8", getAssets().open("web" + path));
            } catch (IOException e) {
                return blocked();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !isLocal(request.getUrl());
        }
    }

    private static boolean isLocal(Uri url) {
        return "https".equals(url.getScheme()) && "app.local".equals(url.getAuthority());
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null,
                new ByteArrayInputStream(new byte[0]));
    }

    private void applySystemBars() {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        getWindow().setStatusBarColor(Color.parseColor(dark ? "#101722" : "#edf6ff"));
        getWindow().setNavigationBarColor(Color.parseColor(dark ? "#101722" : "#ffffff"));
        getWindow().getDecorView().setSystemUiVisibility(dark ? 0 :
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        applySystemBars();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.evaluateJavascript("window.refreshSession && window.refreshSession()", null);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.closeDetails && window.closeDetails()", result -> {
            if (!"true".equals(result)) super.onBackPressed();
        });
    }

    @Override
    protected void onDestroy() {
        if (bridge != null) bridge.close();
        if (web != null) {
            web.removeJavascriptInterface("Android");
            setContentView(new View(this));
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
