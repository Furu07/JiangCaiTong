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
    private static final String PORTAL_HOME = "https://jwxt.jxufe.edu.cn/frame/homes.action";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private ResultReceiver receiver;
    private String script;
    private String term;
    private String kind;
    private String requestedTerm;
    private String account;
    private boolean ownerVerified;
    private boolean entryFallback;
    private String recordPhase;
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
        kind = intent.getStringExtra("kind");
        requestedTerm = intent.getStringExtra("recordTerm");
        account = intent.getStringExtra("account");
        ownerVerified = false;
        entryFallback = false;
        recordPhase = "";
        if (term == null || !term.matches("20\\d{2}-20\\d{2}学年第[一二]学期")) {
            complete(null, "format");
            return START_NOT_STICKY;
        }
        if (kind != null && (!("grades".equals(kind) || "exams".equals(kind)) || account == null
                || !account.matches("[A-Za-z0-9_-]{43}") || requestedTerm == null
                || !requestedTerm.matches("20\\d{2}-20\\d{2}学年第[一二]学期"))) {
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
            Log.i(TAG, kind == null ? "background start" : "records start " + kind);
            web.loadUrl(PORTAL_HOME);
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
                if (!retryTimetableEntry()) complete(null, "expired");
            } else {
                navigated = false;
                read(++document, 0);
            }
        }

        @Override public void onReceivedError(WebView view, WebResourceRequest request,
                                              android.webkit.WebResourceError error) {
            if (web == view && (request.isForMainFrame() || isRecordReport(request.getUrl()))) {
                complete(null, "request");
            }
        }

        @Override public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                                  android.webkit.WebResourceResponse response) {
            if (web != view || !isRecordReport(request.getUrl())) return;
            int status = response.getStatusCode();
            complete(null, status == 401 ? "expired" : status == 403 ? "denied"
                    : status == 404 ? "format" : "request");
        }
    }

    private boolean isRecordReport(Uri url) {
        if (kind == null || !AcademicActivity.isSchool(url) || !AcademicActivity.ACADEMIC.equals(url.getHost())) {
            return false;
        }
        return "/student/xscj.stuckcj_data10421.jsp".equals(url.getPath())
                || "/taglib/DataTable.jsp".equals(url.getPath());
    }

    private void read(int run, int attempt) {
        if (web == null || document != run) return;
        Uri page = Uri.parse(web.getUrl() == null ? "" : web.getUrl());
        if (!AcademicActivity.isSchool(page) || !AcademicActivity.ACADEMIC.equals(page.getHost())) return;
        if (attempt >= 12 && retryTimetableEntry()) return;
        if (attempt >= (ownerVerified ? 32 : 24)) {
            complete(null, "timeout");
            return;
        }
        String args = ownerVerified
                ? JSONObject.quote(kind) + "," + JSONObject.quote(requestedTerm) + "," + !navigated
                : JSONObject.quote(term) + "," + !navigated + "," + (kind != null);
        web.evaluateJavascript(script + "(" + args + ")", result -> {
            if (web == null || document != run) return;
            JSONObject response = AcademicActivity.readObject(result);
            if (response != null && "opened".equals(response.optString("status"))) navigated = true;
            if (ownerVerified) {
                if (readRecord(response)) return;
                handler.postDelayed(() -> read(run, attempt + 1), 650);
                return;
            }
            if (kind != null && response != null && response.has("owner")) {
                try {
                    verifyOwnerAndOpenRecords(response);
                } catch (Exception error) {
                    complete(null, "format");
                }
                return;
            }
            if (kind != null) {
                String status = response == null ? "" : response.optString("status");
                if (!status.equals(recordPhase) && status.matches("opened|page|term|waiting|owner")) {
                    recordPhase = status;
                    Log.i(TAG, "records identity " + kind + " " + status);
                }
                handler.postDelayed(() -> read(run, attempt + 1), 650);
                return;
            }
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

    private boolean retryTimetableEntry() {
        if (kind != null || entryFallback) return false;
        entryFallback = true;
        document++;
        web.loadUrl(AcademicActivity.ENTRY);
        return true;
    }

    private void verifyOwnerAndOpenRecords(JSONObject response) throws Exception {
        String owner = response.getString("owner");
        if (!owner.matches("\\d{5,20}")) throw new IllegalArgumentException();
        if (!account.equals(AcademicActivity.accountKey(this, owner))) {
            complete(null, "account-changed");
            return;
        }
        script = AcademicActivity.loadReader(this, "jufe-record-reader.js");
        ownerVerified = true;
        document++;
        Log.i(TAG, "records owner verified " + kind);
        web.loadUrl(PORTAL_HOME);
    }

    private boolean readRecord(JSONObject response) {
        String status = response == null ? "" : response.optString("status");
        String phase = response == null ? "" : response.optString("phase");
        if (!phase.equals(recordPhase) && phase.matches("menu|cycles|submitted|report")) {
            recordPhase = phase;
            Log.i(TAG, "records phase " + kind + " " + phase);
        }
        if ("format".equals(status) || "term".equals(status)) {
            complete(null, status);
            return true;
        }
        if (!"result".equals(status)) return false;
        try {
            JSONObject capture = new JSONObject().put("accountKey", account)
                    .put("state", response.getString("state")).put("rows", response.getJSONArray("rows"));
            complete(capture.toString(), "");
        } catch (Exception error) {
            complete(null, "format");
        }
        return true;
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
        Log.i(TAG, (kind == null ? "background result " : "records result " + kind + " ")
                + (error.isEmpty() ? "success" : error));
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
