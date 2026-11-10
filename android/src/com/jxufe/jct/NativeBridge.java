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
import java.io.OutputStream;
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
    private static final String WATER_HOST = "i.ilife798.com";
    private static final String WATER_API = "/api/v1";
    private static final String WATER_OFFICIAL_PACKAGE = "com.cloudora.android";
    private static final String WATER_STORE = "https://app.mi.com/details?id=" + WATER_OFFICIAL_PACKAGE;
    private static final int MAX_RESPONSE = 4 * 1024 * 1024;
    private static final String UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

    private final WebView web;
    private final ExecutorService pool = Executors.newSingleThreadExecutor();
    // Only accessed by the serial request executor. Never persisted or shared with Chaoxing.
    private String waterAttempt = "";
    private java.net.CookieManager waterLoginCookies;
    private volatile boolean closed;
    private volatile boolean clearingWebCookies;

    NativeBridge(WebView web) {
        this.web = web;
    }

    @JavascriptInterface
    public void req2(int id, String method, String url, String body, String referer, String headers, String studyScope, String attempt) {
        if (closed) return;
        boolean study = isChaoxing(Uri.parse(url));
        java.net.CookieManager studyCookies = study ? CxNet.cookieJar(studyScope) : null;
        pool.execute(() -> {
            JSONObject result;
            try {
                URL target = new URL(url);
                java.net.CookieManager waterCookies = waterLoginJar(method, target, attempt);
                result = study && !CxNet.isCurrent(studyCookies) ? failure(401)
                        : request(method, target, body, referer, headers, studyCookies, waterCookies);
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
                String json = study && !CxNet.isCurrent(studyCookies) ? failure(401).toString() : response;
                web.evaluateJavascript("window.__nativeDone(" + id + "," + JSONObject.quote(json) + ")", null);
            });
        });
    }

    @JavascriptInterface
    public boolean debugDiagnosticsEnabled() {
        return (web.getContext().getApplicationInfo().flags
                & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    @JavascriptInterface
    public void clearWaterAttempt(String attempt) {
        if (closed) return;
        pool.execute(() -> {
            if (waterAttempt.equals(attempt)) {
                waterAttempt = "";
                waterLoginCookies = null;
            }
        });
    }

    private static String exceptionKind(Exception error) {
        if (error instanceof java.net.SocketTimeoutException) return "Timeout";
        if (error instanceof javax.net.ssl.SSLException) return "TLS";
        if (error instanceof SecurityException) return "Policy";
        if (error instanceof IOException) return "IO";
        return "Other";
    }

    private java.net.CookieManager waterLoginJar(String method, URL url, String attempt) {
        Uri uri = Uri.parse(url.toString());
        if (!"POST".equals(method) || !isHttps(uri) || !WATER_HOST.equals(uri.getHost())) return null;
        String path = uri.getPath();
        if (((WATER_API + "/acc/login/code").equals(path) || (WATER_API + "/acc/login").equals(path))
                && !waterLoginConfigured()) throw new SecurityException("Water login configuration unavailable");
        if ((WATER_API + "/acc/login/code").equals(path)) {
            if (attempt == null || !attempt.matches("[A-Za-z0-9]{10}")) throw new SecurityException("Missing SMS attempt");
            waterAttempt = attempt;
            waterLoginCookies = new java.net.CookieManager(null, java.net.CookiePolicy.ACCEPT_ORIGINAL_SERVER);
            return waterLoginCookies;
        }
        if ((WATER_API + "/acc/login").equals(path)) {
            if (waterLoginCookies == null || !waterAttempt.equals(attempt)) throw new SecurityException("SMS attempt changed");
            return waterLoginCookies;
        }
        return null;
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
        return isHttps(url) && WATER_HOST.equals(url.getHost())
                && (WATER_API + "/captcha/").equals(url.getPath());
    }

    private static boolean isHttps(Uri url) {
        return "https".equals(url.getScheme()) && url.getUserInfo() == null
                && (url.getPort() == -1 || url.getPort() == 443);
    }

    private static boolean allowed(String method, URL url) {
        Uri uri = Uri.parse(url.toString());
        if (isChaoxing(uri)) return CxNet.isHost(uri.getHost()) && "GET".equals(method);
        if (!isHttps(uri) || !WATER_HOST.equals(uri.getHost())) return false;
        String path = url.getPath();
        if ("GET".equals(method)) {
            return (WATER_API + "/acc/wallet/owner").equals(path)
                    || (WATER_API + "/ui/app/master").equals(path)
                    || (WATER_API + "/bill/lst-owner").equals(path);
        }
        return "POST".equals(method) && ((WATER_API + "/acc/login/code").equals(path)
                || (WATER_API + "/acc/login").equals(path));
    }

    private JSONObject request(String method, URL url, String body, String referer,
                               String headers, java.net.CookieManager studyCookies,
                               java.net.CookieManager waterCookies) throws Exception {
        boolean study = studyCookies != null;
        java.net.CookieManager cookies = study ? studyCookies : waterCookies;
        String customHeaders = headers;
        for (int redirects = 0; redirects <= 5; redirects++) {
            if (study && !CxNet.isCurrent(studyCookies)) return failure(401);
            if (!allowed(method, url)) throw new SecurityException("Unsupported request");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            try {
                connection.setRequestMethod(method);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(25000);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("User-Agent", UA);
                connection.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9");
                if (study && !referer.isEmpty() && isChaoxing(Uri.parse(referer))) {
                    connection.setRequestProperty("Referer", referer);
                }
                applyHeaders(connection, customHeaders, study);
                boolean sentCookie = false;
                if (cookies != null) {
                    for (Map.Entry<String, List<String>> header :
                            cookies.get(url.toURI(), Collections.emptyMap()).entrySet()) {
                        for (String value : header.getValue()) {
                            connection.addRequestProperty(header.getKey(), value);
                            if ("Cookie".equalsIgnoreCase(header.getKey()) && !value.isEmpty()) sentCookie = true;
                        }
                    }
                }
                if ("POST".equals(method)) {
                    byte[] payload = body.getBytes(StandardCharsets.UTF_8);
                    connection.setDoOutput(true);
                    connection.setFixedLengthStreamingMode(payload.length);
                    try (OutputStream out = connection.getOutputStream()) {
                        out.write(payload);
                    }
                }
                int status = connection.getResponseCode();
                if (cookies != null) cookies.put(url.toURI(), connection.getHeaderFields());
                if (study && status >= 300 && status < 400) {
                    String location = connection.getHeaderField("Location");
                    if (location != null && !location.isEmpty()) {
                        URL next = new URL(url, location);
                        if (!allowed(method, next) || !isChaoxing(Uri.parse(next.toString()))) break;
                        if (!url.getHost().equals(next.getHost())) customHeaders = "";
                        url = next;
                        continue;
                    }
                }
                JSONObject result = new JSONObject();
                result.put("status", status);
                if (waterCookies != null) {
                    result.put("sessionSent", sentCookie);
                    result.put("sessionPresent", !waterCookies.getCookieStore().getCookies().isEmpty());
                    if (debugDiagnosticsEnabled()) {
                        result.put("setCookiePresent", connection.getHeaderField("Set-Cookie") != null
                                || connection.getHeaderField("Set-Cookie2") != null);
                    }
                }
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

    private static void applyHeaders(HttpURLConnection connection, String headers, boolean study) throws Exception {
        if (headers.isEmpty()) return;
        JSONObject values = new JSONObject(headers);
        Iterator<String> keys = values.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            switch (key) {
                case "Authorization":
                    if (!study) connection.setRequestProperty(key, values.getString(key));
                    break;
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
    @JavascriptInterface public String cxPersist(String expected) { return CxNet.persist(expected); }
    @JavascriptInterface public void cxInvalidate(String expected) { CxNet.invalidate(expected); }
    @JavascriptInterface public String loadWater() { return CredStore.loadWater(); }
    @JavascriptInterface public String saveWater(String value) { return CredStore.saveWater(value); }
    @JavascriptInterface public boolean waterLoginConfigured() { return !WaterLoginConfig.SALT_BASE64.isEmpty(); }

    @JavascriptInterface
    public String signWaterLogin(String phone, String code) {
        if (!waterLoginConfigured() || phone == null || !phone.matches("1\\d{10}")
                || code == null || !code.matches("\\d{4,10}")) return "";
        try {
            java.security.MessageDigest digest = java.security.MessageDigest.getInstance("MD5");
            digest.update(("authCode=" + code + "&un=" + phone).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            byte[] hash = digest.digest(android.util.Base64.decode(WaterLoginConfig.SALT_BASE64, android.util.Base64.NO_WRAP));
            StringBuilder signature = new StringBuilder(hash.length * 2);
            for (byte value : hash) {
                signature.append(Character.forDigit((value & 0xff) >>> 4, 16));
                signature.append(Character.forDigit(value & 0xf, 16));
            }
            return signature.toString();
        } catch (java.security.NoSuchAlgorithmException error) {
            return "";
        }
    }
    @JavascriptInterface public String waterState() { return CredStore.waterState(); }
    @JavascriptInterface public void clearWater() { CredStore.clearWater(); }

    @JavascriptInterface
    public void openOfficialWater() {
        web.post(() -> {
            if (closed) return;
            android.content.Context context = web.getContext();
            Intent launch = context.getPackageManager().getLaunchIntentForPackage(WATER_OFFICIAL_PACKAGE);
            if (launch != null) {
                try {
                    context.startActivity(launch);
                    return;
                } catch (ActivityNotFoundException | SecurityException ignored) { }
            }
            try {
                context.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(WATER_STORE))
                        .addCategory(Intent.CATEGORY_BROWSABLE));
            } catch (ActivityNotFoundException | SecurityException error) {
                Toast.makeText(context, "请在应用商店搜索长沙云多啦发布的慧生活798", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @JavascriptInterface
    public void cxClear() {
        CxNet.clearSession();
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
    public void clearWebCache() {
        web.post(() -> {
            if (!closed) web.clearCache(true);
        });
    }

    void close() {
        closed = true;
        pool.shutdownNow();
    }
}
