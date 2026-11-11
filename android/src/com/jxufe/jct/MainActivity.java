package com.jxufe.jct;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;

public class MainActivity extends Activity {
    private static final int CHOOSE_TIMETABLE = 31;
    private static final int ACADEMIC_VISIT = 32;
    private boolean academicVisitActive;
    private boolean academicReturning;

    void openAcademicBinding() {
        if (android.os.Build.VERSION.SDK_INT < 28) {
            bridge.openAcademicPortal();
            return;
        }
        startAcademicVisit(new Intent(this, AcademicActivity.class));
    }

    boolean openAcademicSync(String term) {
        return startAcademicVisit(new Intent(this, AcademicActivity.class)
                .putExtra("automatic", true).putExtra("term", term));
    }

    private boolean startAcademicVisit(Intent intent) {
        if (academicVisitActive || isFinishing() || isDestroyed()) return false;
        academicVisitActive = true;
        try {
            android.util.Log.i("JctAcademic", "interactive start");
            startActivityForResult(intent, ACADEMIC_VISIT);
            return true;
        } catch (ActivityNotFoundException | SecurityException error) {
            academicVisitActive = false;
            return false;
        }
    }

    boolean hasAcademicVisit() { return academicVisitActive; }
    private static final String ORIGIN = "https://app.local";
    private WebView web;
    private NativeBridge bridge;
    private ValueCallback<Uri[]> fileSelection;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        academicVisitActive = state != null && state.getBoolean("academicVisitActive");
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
        settings.setUserAgentString(settings.getUserAgentString() + " JiangCaiTong/0.6.6");
        bridge = new NativeBridge(web);
        web.addJavascriptInterface(bridge, "Android");
        web.setWebViewClient(new AssetClient());
        web.setWebChromeClient(new LocalFileChooser());
        applySystemBars();
        Store.trimWebViewCache(this, web);
        web.loadUrl(ORIGIN + "/index.html");
    }

    private final class LocalFileChooser extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (!isLocal(Uri.parse(view.getUrl() == null ? "" : view.getUrl()))
                    || params.getMode() != FileChooserParams.MODE_OPEN || fileSelection != null) return false;
            Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
            picker.setType("*/*");
            picker.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/html", "text/plain"});
            try {
                startActivityForResult(picker, CHOOSE_TIMETABLE);
                fileSelection = callback;
            } catch (ActivityNotFoundException error) {
                callback.onReceiveValue(null);
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == ACADEMIC_VISIT) {
            academicVisitActive = false;
            academicReturning = true;
            String structure = data == null ? "" : data.getStringExtra("structure");
            String grid = data == null ? "" : data.getStringExtra("gridProjection");
            String capture = data == null ? "" : data.getStringExtra("capture");
            String syncError = data == null ? "" : data.getStringExtra("syncError");
            if (web != null) web.evaluateJavascript("window.academicPortalReturned && window.academicPortalReturned("
                    + org.json.JSONObject.quote(structure == null ? "" : structure) + ","
                    + org.json.JSONObject.quote(grid == null ? "" : grid) + ","
                    + org.json.JSONObject.quote(capture == null ? "" : capture) + ","
                    + org.json.JSONObject.quote(syncError == null ? "" : syncError) + ")", null);
            return;
        }
        if (request != CHOOSE_TIMETABLE || fileSelection == null) return;
        Uri selected = result == RESULT_OK && data != null ? data.getData() : null;
        ValueCallback<Uri[]> callback = fileSelection;
        fileSelection = null;
        callback.onReceiveValue(selected != null && "content".equals(selected.getScheme())
                ? new Uri[]{selected} : null);
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
        boolean refreshAcademic = !academicReturning && !academicVisitActive;
        academicReturning = false;
        if (web != null) web.evaluateJavascript("window.refreshSession && window.refreshSession();"
                + "window.resumeStudyUpdates && window.resumeStudyUpdates();"
                + (refreshAcademic ? "window.resumeAcademicSync && window.resumeAcademicSync()" : ""), null);
    }

    @Override protected void onPause() {
        if (web != null) web.evaluateJavascript("window.pauseStudyUpdates && window.pauseStudyUpdates()", null);
        super.onPause();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("academicVisitActive", academicVisitActive);
        super.onSaveInstanceState(state);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.closeDetails && window.closeDetails()", result -> {
            if (!"true".equals(result)) super.onBackPressed();
        });
    }

    @Override
    protected void onDestroy() {
        if (fileSelection != null) {
            fileSelection.onReceiveValue(null);
            fileSelection = null;
        }
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
