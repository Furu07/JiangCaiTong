package com.jxufe.jct;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Transport and local storage for the bundled assets. Remote pages have no bridge. */
public final class NativeBridge {
    private static final String WATER_OFFICIAL_PACKAGE = "com.cloudora.android";
    private static final String WATER_STORE = "https://app.mi.com/details?id=" + WATER_OFFICIAL_PACKAGE;
    private static final String ZHULI_OFFICIAL_PACKAGE = "com.whxinna.userplatform";
    private static final String ZHULI_STORE = "https://sj.qq.com/appdetail/" + ZHULI_OFFICIAL_PACKAGE;
    private static final int MAX_RESPONSE = 4 * 1024 * 1024;
    private static final String UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

    private final WebView web;
    private final ExecutorService pool = Executors.newSingleThreadExecutor();
    private final ExecutorService waterPool = Executors.newCachedThreadPool();
    private volatile boolean closed;
    private volatile boolean clearingWebCookies;

    NativeBridge(WebView web) {
        this.web = web;
    }

    @JavascriptInterface
    public void req2(int id, String method, String url, String body, String referer, String headers, String studyScope) {
        if (closed) return;
        boolean study = isChaoxing(Uri.parse(url));
        java.net.CookieManager loginCookies = study ? CxNet.loginJar(studyScope) : null;
        java.net.CookieManager studyCookies = loginCookies != null ? loginCookies : study ? CxNet.cookieJar(studyScope) : null;
        (study ? pool : waterPool).execute(() -> {
            JSONObject result;
            try {
                URL target = new URL(url);
                if (study) {
                    result = currentStudyRequest(studyCookies, studyScope, loginCookies != null)
                            ? request(method, target, body, referer, headers, studyCookies, studyScope,
                                      loginCookies != null) : failure(401);
                } else {
                    result = WaterHttp.request(method, target, body, headers, debugDiagnosticsEnabled());
                }
            } catch (Exception e) {
                result = failure(0);
                if (debugDiagnosticsEnabled()) {
                    try { result.put("exception", exceptionKind(e)); }
                    catch (org.json.JSONException ignored) { }
                }
            }
            String response = result.toString();
            web.post(() -> {
                if (closed) return;
                String json = study && !currentStudyRequest(studyCookies, studyScope, loginCookies != null)
                        ? failure(401).toString() : response;
                web.evaluateJavascript("window.__nativeDone(" + id + "," + JSONObject.quote(json) + ")", null);
            });
        });
    }

    @JavascriptInterface
    public boolean debugDiagnosticsEnabled() {
        return (web.getContext().getApplicationInfo().flags
                & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private static String exceptionKind(Exception error) {
        if (error instanceof java.net.SocketTimeoutException) return "Timeout";
        if (error instanceof javax.net.ssl.SSLException) return "TLS";
        if (error instanceof SecurityException) return "Policy";
        if (error instanceof IOException) return "IO";
        return "Other";
    }

    private static JSONObject failure(int status) {
        JSONObject result = new JSONObject();
        try {
            result.put("status", status);
        } catch (org.json.JSONException ignored) { }
        return result;
    }

    static boolean isChaoxing(Uri url) {
        String host = url.getHost();
        return isHttps(url) && host != null
                && (host.equals("chaoxing.com") || host.endsWith(".chaoxing.com"));
    }

    static boolean isWaterCaptcha(Uri url) {
        return WaterHttp.isCaptcha(url);
    }

    private static boolean isHttps(Uri url) {
        return "https".equals(url.getScheme()) && url.getUserInfo() == null
                && (url.getPort() == -1 || url.getPort() == 443);
    }

    private static boolean currentStudyRequest(java.net.CookieManager cookies, String scope, boolean login) {
        return login ? cookies != null && CxNet.loginJar(scope) == cookies : CxNet.isCurrent(cookies);
    }

    private static boolean allowed(String method, URL url, boolean login) {
        Uri uri = Uri.parse(url.toString());
        return isChaoxing(uri) && CxNet.isHost(uri.getHost()) && ("GET".equals(method)
                || (login && "POST".equals(method) && "passport2.chaoxing.com".equals(uri.getHost())
                    && "/fanyalogin".equals(uri.getPath()) && uri.getQuery() == null));
    }

    private JSONObject request(String method, URL url, String body, String referer, String headers,
                               java.net.CookieManager studyCookies, String scope, boolean login) throws Exception {
        String customHeaders = headers;
        for (int redirects = 0; redirects <= 5; redirects++) {
            if (!currentStudyRequest(studyCookies, scope, login)) return failure(401);
            if (!allowed(method, url, login)) throw new SecurityException("Unsupported request");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            try {
                connection.setRequestMethod(method);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("User-Agent", UA);
                connection.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9");
                connection.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
                if (!referer.isEmpty() && isChaoxing(Uri.parse(referer))) {
                    connection.setRequestProperty("Referer", referer);
                }
                applyHeaders(connection, customHeaders);
                for (Map.Entry<String, List<String>> header :
                        studyCookies.get(url.toURI(), Collections.emptyMap()).entrySet()) {
                    for (String value : header.getValue()) {
                        connection.addRequestProperty(header.getKey(), value);
                    }
                }
                if ("POST".equals(method)) {
                    byte[] data = body.getBytes(StandardCharsets.UTF_8);
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                    connection.setFixedLengthStreamingMode(data.length);
                    try (java.io.OutputStream out = connection.getOutputStream()) {
                        out.write(data);
                    }
                }
                int status = connection.getResponseCode();
                studyCookies.put(url.toURI(), connection.getHeaderFields());
                if ("GET".equals(method) && status >= 300 && status < 400) {
                    String location = connection.getHeaderField("Location");
                    if (location != null && !location.isEmpty()) {
                        URL next = new URL(url, location);
                        if (!allowed(method, next, login)) break;
                        if (!url.getHost().equals(next.getHost())) customHeaders = "";
                        url = next;
                        continue;
                    }
                }
                JSONObject result = new JSONObject();
                result.put("status", status);
                result.put("serverTime", connection.getDate());
                result.put("body", readAll(status >= 400 ? connection.getErrorStream()
                                                        : connection.getInputStream()));
                result.put("url", url.toString());
                return result;
            } finally {
                connection.disconnect();
            }
        }
        throw new SecurityException("Unsupported redirect");
    }

    private static void applyHeaders(HttpURLConnection connection, String headers) throws Exception {
        if (headers.isEmpty()) return;
        JSONObject values = new JSONObject(headers);
        Iterator<String> keys = values.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            switch (key) {
                case "User-Agent":
                case "Accept":
                case "Accept-Language":
                case "Content-Type":
                case "ApplicationType":
                case "VersionCode":
                case "X-Requested-With":
                    connection.setRequestProperty(key, values.getString(key));
                    break;
                default:
                    break;
            }
        }
    }

    private static String readAll(InputStream stream) throws Exception {
        if (stream == null) return "";
        try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = in.read(buffer)) != -1) {
                if (out.size() + count > MAX_RESPONSE) throw new java.io.IOException("Response too large");
                out.write(buffer, 0, count);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    @JavascriptInterface public boolean cxHasLogin() { return CxNet.hasLogin(); }
    @JavascriptInterface public String cxSessionKey() { return CxNet.sessionKey(); }
    @JavascriptInterface public String cxAccountKey(String expected) { return CxNet.accountKey(expected); }
    @JavascriptInterface public String cxPersist(String expected) { return CxNet.persist(expected); }
    @JavascriptInterface public void cxInvalidate(String expected) { CxNet.invalidate(expected); }
    @JavascriptInterface public String cxBeginLogin() { return CxNet.beginLogin(); }
    @JavascriptInterface public String cxFinishLogin(String ticket) { return CxNet.finishLogin(ticket); }
    @JavascriptInterface public void cxCancelLogin(String ticket) { CxNet.cancelLogin(ticket); }
    @JavascriptInterface public String cxAes(String password) { return CxNet.aesB64(password); }
    @JavascriptInterface public boolean cxHasSavedLogin() { return !CredStore.loadCxCredentials().isEmpty(); }
    @JavascriptInterface public String cxSavedLoginForm() {
        try {
            JSONObject data = new JSONObject(CredStore.loadCxCredentials());
            String current = CxNet.accountKey(CxNet.sessionKey());
            if (!current.isEmpty() && !current.equals(data.optString("account"))) return "";
            return new JSONObject().put("u", data.getString("u"))
                    .put("p", CxNet.aesB64(data.getString("p"))).toString();
        } catch (org.json.JSONException error) {
            return "";
        }
    }
    @JavascriptInterface public String cxSaveCredentials(String value) {
        try {
            if (value.isEmpty()) return CredStore.saveCxCredentials("");
            String account = CxNet.accountKey(CxNet.sessionKey());
            if (account.isEmpty()) return "无法确认学习通账号，密码未保存。";
            JSONObject data = new JSONObject(value);
            return CredStore.saveCxCredentials(new JSONObject().put("u", data.getString("u"))
                    .put("p", data.getString("p")).put("account", account).toString());
        } catch (org.json.JSONException | IllegalStateException error) {
            return "无法更新本机保存的学习通账号。";
        }
    }
    @JavascriptInterface public String loadWater() { return CredStore.loadWater(); }
    @JavascriptInterface public String saveWater(String value) { return CredStore.saveWater(value); }
    @JavascriptInterface public String waterState() { return CredStore.waterState(); }
    @JavascriptInterface public void clearWater() {
        CredStore.clearWater();
        if (!closed) WaterHttp.clearCookies();
    }

    @JavascriptInterface
    public void openOfficialWater() {
        openOfficialApp(WATER_OFFICIAL_PACKAGE, WATER_STORE, "请在应用商店搜索长沙云多啦发布的慧生活798");
    }

    @JavascriptInterface
    public boolean zhuliAppAvailable() {
        return !closed && web.getContext().getPackageManager().getLaunchIntentForPackage(ZHULI_OFFICIAL_PACKAGE) != null;
    }

    @JavascriptInterface
    public void openOfficialZhuli() {
        openOfficialApp(ZHULI_OFFICIAL_PACKAGE, ZHULI_STORE, "请在应用商店搜索武汉辛纳发布的住理生活");
    }

    private void openOfficialApp(String packageName, String store, String unavailableMessage) {
        web.post(() -> {
            if (closed) return;
            android.content.Context context = web.getContext();
            try {
                Intent launch = context.getPackageManager().getLaunchIntentForPackage(packageName);
                if (launch != null) {
                    context.startActivity(launch);
                    return;
                }
            } catch (ActivityNotFoundException | SecurityException ignored) { }
            try {
                context.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(store))
                        .addCategory(Intent.CATEGORY_BROWSABLE));
            } catch (ActivityNotFoundException | SecurityException error) {
                Toast.makeText(context, unavailableMessage, Toast.LENGTH_SHORT).show();
            }
        });
    }

    @JavascriptInterface
    public void cxClear() {
        CxNet.clearSession();
        CredStore.saveCxCredentials("");
        clearingWebCookies = true;
        web.post(() -> CookieManager.getInstance().removeAllCookies(removed -> {
            CookieManager.getInstance().flush();
            clearingWebCookies = false;
        }));
    }

    @JavascriptInterface
    public boolean openStudyLogin() {
        if (closed || clearingWebCookies) return false;
        web.post(() -> {
            if (!closed) web.getContext().startActivity(new Intent(web.getContext(), WebActivity.class));
        });
        return true;
    }

    @JavascriptInterface
    public boolean openStudyTask(String value) {
        if (closed || value == null) return false;
        Uri uri = Uri.parse(value);
        if (!isChaoxing(uri)) return false;
        return web.post(() -> {
            if (closed) return;
            try {
                web.getContext().startActivity(new Intent(web.getContext(), WebActivity.class)
                        .putExtra("studyTask", uri.toString()));
            } catch (ActivityNotFoundException | SecurityException error) {
                Toast.makeText(web.getContext(), "无法打开学习通任务", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @JavascriptInterface
    public void openAcademicBinding() {
        web.post(() -> {
            if (!closed) ((MainActivity) web.getContext()).openAcademicBinding();
        });
    }

    @JavascriptInterface
    public boolean supportsAcademicSync() {
        return android.os.Build.VERSION.SDK_INT >= 28;
    }

    @JavascriptInterface
    public boolean disconnectAcademic() {
        if (closed || !supportsAcademicSync()) return false;
        return web.post(() -> {
            MainActivity activity = (MainActivity) web.getContext();
            android.os.ResultReceiver receiver = new android.os.ResultReceiver(
                    new android.os.Handler(android.os.Looper.getMainLooper())) {
                @Override protected void onReceiveResult(int code, android.os.Bundle data) {
                    academicDisconnected(data.getString("error", ""));
                }
            };
            if (!closed && !activity.hasAcademicVisit()) {
                try {
                    if (activity.startService(new Intent(activity, AcademicSyncService.class)
                            .setAction(AcademicSyncService.DISCONNECT).putExtra("receiver", receiver)) != null) return;
                } catch (IllegalStateException | SecurityException ignored) { }
            }
            academicDisconnected("busy");
        });
    }

    private void academicDisconnected(String error) {
        if (!closed) web.evaluateJavascript("window.academicDisconnected && window.academicDisconnected("
                + JSONObject.quote(error) + ")", null);
    }

    @JavascriptInterface
    public boolean academicOnline() {
        android.net.ConnectivityManager manager =
                web.getContext().getSystemService(android.net.ConnectivityManager.class);
        if (manager == null) return false;
        android.net.Network network = manager.getActiveNetwork();
        android.net.NetworkCapabilities capabilities = network == null ? null : manager.getNetworkCapabilities(network);
        return capabilities != null && capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    }

    @JavascriptInterface
    public boolean openAcademicSync(String term, boolean interactive) {
        if (closed || android.os.Build.VERSION.SDK_INT < 28 || term == null
                || (!term.isEmpty() && !term.matches("20\\d{2}-20\\d{2}学年第[一二]学期"))) return false;
        return web.post(() -> {
            if (closed) return;
            MainActivity activity = (MainActivity) web.getContext();
            if (interactive) {
                if (!activity.openAcademicSync(term)) {
                    web.evaluateJavascript("window.academicPortalReturned('','','','busy')", null);
                }
                return;
            }
            if (activity.hasAcademicVisit()) {
                academicBackgroundResult("", "busy");
                return;
            }
            android.os.ResultReceiver receiver = new android.os.ResultReceiver(
                    new android.os.Handler(android.os.Looper.getMainLooper())) {
                @Override protected void onReceiveResult(int code, android.os.Bundle data) {
                    if (!closed) academicBackgroundResult(data.getString("capture", ""), data.getString("error", ""));
                }
            };
            try {
                if (activity.startService(new Intent(activity, AcademicSyncService.class)
                        .putExtra("term", term).putExtra("receiver", receiver)) == null) {
                    academicBackgroundResult("", "request");
                }
            } catch (IllegalStateException | SecurityException error) {
                academicBackgroundResult("", "request");
            }
        });
    }

    private void academicBackgroundResult(String capture, String error) {
        web.evaluateJavascript("window.academicBackgroundReturned && window.academicBackgroundReturned("
                + JSONObject.quote(capture == null ? "" : capture) + "," + JSONObject.quote(error) + ")", null);
    }

    @JavascriptInterface
    public boolean openAcademicRecords(int requestId, String kind, String term, String verificationTerm, String account) {
        if (closed || android.os.Build.VERSION.SDK_INT < 28 || !AcademicSyncService.validRecordQuery(kind, term)
                || verificationTerm == null || !verificationTerm.matches("20\\d{2}-20\\d{2}学年第[一二]学期")
                || account == null || !account.matches("[A-Za-z0-9_-]{43}")) return false;
        return web.post(() -> {
            if (closed) return;
            MainActivity activity = (MainActivity) web.getContext();
            if (activity.hasAcademicVisit()) {
                academicRecordsResult(requestId, "", "busy");
                return;
            }
            android.os.ResultReceiver receiver = new android.os.ResultReceiver(
                    new android.os.Handler(android.os.Looper.getMainLooper())) {
                @Override protected void onReceiveResult(int code, android.os.Bundle data) {
                    if (!closed) academicRecordsResult(requestId,
                            data.getString("capture", ""), data.getString("error", ""));
                }
            };
            try {
                if (activity.startService(new Intent(activity, AcademicSyncService.class).putExtra("kind", kind)
                        .putExtra("term", verificationTerm).putExtra("recordTerm", term).putExtra("account", account)
                        .putExtra("receiver", receiver)) == null) academicRecordsResult(requestId, "", "request");
            } catch (IllegalStateException | SecurityException error) {
                academicRecordsResult(requestId, "", "request");
            }
        });
    }

    private void academicRecordsResult(int requestId, String capture, String error) {
        web.evaluateJavascript("window.academicRecordsReturned && window.academicRecordsReturned("
                + requestId + "," + JSONObject.quote(capture == null ? "" : capture) + ","
                + JSONObject.quote(error) + ")", null);
    }

    @JavascriptInterface
    public void openAcademicPortal() {
        web.post(() -> {
            if (closed) return;
            Intent intent = new Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://jwxt.jxufe.edu.cn/jxcjcaslogin"));
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            try {
                web.getContext().startActivity(intent);
            } catch (ActivityNotFoundException e) {
                Toast.makeText(web.getContext(), "系统浏览器暂不可用", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @JavascriptInterface
    public boolean systemUiDark() {
        return ((MainActivity) web.getContext()).systemUiDark();
    }

    @JavascriptInterface
    public void setUiTheme(boolean dark) {
        web.post(() -> {
            if (!closed) ((MainActivity) web.getContext()).applyUiTheme(dark);
        });
    }

    @JavascriptInterface
    public void clearWebCache() {
        web.post(() -> {
            if (!closed) web.clearCache(true);
        });
    }

    void close() {
        closed = true;
        pool.shutdownNow();
        waterPool.shutdownNow();
    }
}
