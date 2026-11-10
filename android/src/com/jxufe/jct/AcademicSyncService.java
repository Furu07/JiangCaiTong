package com.jxufe.jct;

import android.annotation.SuppressLint;
import android.app.Service;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.ResultReceiver;
import android.util.Log;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONObject;

/** A read-only refresh in the isolated academic profile, with no authentication UI. */
public final class AcademicSyncService extends Service {
    private static final String TAG = "JctAcademic";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private ResultReceiver receiver;
    private String script;
    private String term;
    private int document;
    private boolean navigated;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override @SuppressLint("SetJavaScriptEnabled")
    public int onStartCommand(Intent intent, int flags, int startId) {
        ResultReceiver callback = intent == null ? null : intent.getParcelableExtra("receiver");
        if (callback == null) {
            if (receiver == null) stopSelf();
            return START_NOT_STICKY;
        }
        if (receiver != null) {
            send(callback, null, "busy");
            return START_NOT_STICKY;
        }
        receiver = callback;
        term = intent.getStringExtra("term");
        if (term == null || !term.matches("20\\d{2}-20\\d{2}学年第[一二]学期")) {
            complete(null, "format");
            return START_NOT_STICKY;
        }
        try {
            script = AcademicActivity.loadReader(this);
            web = new WebView(this);
            web.getSettings().setJavaScriptEnabled(true);
            web.getSettings().setDomStorageEnabled(true);
            web.getSettings().setAllowFileAccess(false);
            web.getSettings().setAllowContentAccess(false);
            web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
            web.setWebViewClient(new ReaderClient());
            int width = View.MeasureSpec.makeMeasureSpec(1024, View.MeasureSpec.EXACTLY);
            int height = View.MeasureSpec.makeMeasureSpec(768, View.MeasureSpec.EXACTLY);
            web.measure(width, height);
            web.layout(0, 0, 1024, 768);
            handler.postDelayed(() -> complete(null, "timeout"), 30000);
            Log.i(TAG, "background start");
            web.loadUrl(AcademicActivity.ENTRY);
        } catch (Exception error) {
            complete(null, "request");
        }
        return START_NOT_STICKY;
    }

    private final class ReaderClient extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return request.isForMainFrame() && !AcademicActivity.isSchool(request.getUrl());
        }

        @Override public void onPageFinished(WebView view, String url) {
            if (web != view || !url.equals(view.getUrl())) return;
            Uri page = Uri.parse(url);
            if (!AcademicActivity.isSchool(page)) return;
            if (AcademicActivity.AUTH.equals(page.getHost())) {
                complete(null, "expired");
            } else {
                navigated = false;
                read(++document, 0);
            }
        }

        @Override public void onReceivedError(WebView view, WebResourceRequest request,
                                              android.webkit.WebResourceError error) {
            if (web == view && request.isForMainFrame()) complete(null, "request");
        }
    }

    private void read(int run, int attempt) {
        if (web == null || document != run) return;
        Uri page = Uri.parse(web.getUrl() == null ? "" : web.getUrl());
        if (!AcademicActivity.isSchool(page) || !AcademicActivity.ACADEMIC.equals(page.getHost())) return;
        if (attempt >= 24) {
            complete(null, "timeout");
            return;
        }
        web.evaluateJavascript(script + "(" + JSONObject.quote(term) + "," + !navigated + ")", result -> {
            if (web == null || document != run) return;
            JSONObject response = AcademicActivity.readObject(result);
            if (response != null && "opened".equals(response.optString("status"))) navigated = true;
            String grid = AcademicActivity.sanitizeGridProjection(result);
            if (grid.isEmpty() || response == null) {
                handler.postDelayed(() -> read(run, attempt + 1), 650);
                return;
            }
            try {
                complete(AcademicActivity.verifiedCapture(this, grid, response), "");
            } catch (Exception error) {
                complete(null, "format");
            }
        });
    }

    private static void send(ResultReceiver callback, String capture, String error) {
        Bundle result = new Bundle();
        result.putString("capture", capture);
        result.putString("error", error);
        callback.send(0, result);
    }

    private void complete(String capture, String error) {
        if (receiver == null) return;
        ResultReceiver callback = receiver;
        receiver = null;
        release();
        Log.i(TAG, "background result " + (error.isEmpty() ? "success" : error));
        stopSelf();
        send(callback, capture, error);
    }

    private void release() {
        handler.removeCallbacksAndMessages(null);
        if (web == null) return;
        WebView view = web;
        web = null;
        view.stopLoading();
        view.destroy();
    }

    @Override public void onDestroy() {
        release();
        super.onDestroy();
    }
}
