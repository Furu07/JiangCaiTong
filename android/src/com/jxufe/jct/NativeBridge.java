package com.jxufe.jct;

import android.content.Intent;
import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Transport and local storage for the bundled assets. Remote pages have no bridge. */
public final class NativeBridge {
    private static final String WATER_HOST = "i.ilife798.com";
    private static final String WATER_API = "/api/v1";
    private static final int MAX_RESPONSE = 4 * 1024 * 1024;
    private static final String UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

    private final WebView web;
    private final ExecutorService pool = Executors.newSingleThreadExecutor();
    private volatile boolean closed;
    private volatile boolean clearingWebCookies;

    NativeBridge(WebView web) {
        this.web = web;
    }

    @JavascriptInterface
    public void req2(int id, String method, String url, String body, String referer, String headers) {
        if (closed) return;
        pool.execute(() -> {
            JSONObject result;
            try {
                result = request(method, new URL(url), body, referer, headers);
            } catch (Exception e) {
                result = new JSONObject();
                try {
                    result.put("status", 0);
                } catch (org.json.JSONException ignored) { }
            }
            String json = result.toString();
            web.post(() -> {
                if (!closed) web.evaluateJavascript(
                        "window.__nativeDone(" + id + "," + JSONObject.quote(json) + ")", null);
            });
        });
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
        if (isChaoxing(uri)) return "GET".equals(method);
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

    private static JSONObject request(String method, URL url, String body, String referer,
                                      String headers) throws Exception {
        boolean study = isChaoxing(Uri.parse(url.toString()));
        String customHeaders = headers;
        for (int redirects = 0; redirects <= 5; redirects++) {
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
                applyHeaders(connection, customHeaders);
                if ("POST".equals(method)) {
                    byte[] payload = body.getBytes(StandardCharsets.UTF_8);
                    connection.setDoOutput(true);
                    connection.setFixedLengthStreamingMode(payload.length);
                    try (OutputStream out = connection.getOutputStream()) {
                        out.write(payload);
                    }
                }
                int status = connection.getResponseCode();
                if (study && status >= 300 && status < 400) {
                    String location = connection.getHeaderField("Location");
                    if (location != null && !location.isEmpty()) {
                        URL next = new URL(url, location);
                        if (!isChaoxing(Uri.parse(next.toString()))) break;
                        if (!url.getHost().equals(next.getHost())) customHeaders = "";
                        url = next;
                        continue;
                    }
                }
                JSONObject result = new JSONObject();
                result.put("status", status);
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
                case "Authorization":
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
    @JavascriptInterface public String cxPersist() { return CredStore.saveCx(CxNet.dumpCookies()); }
    @JavascriptInterface public String loadWater() { return CredStore.loadWater(); }
    @JavascriptInterface public String saveWater(String value) { return CredStore.saveWater(value); }
    @JavascriptInterface public String waterState() { return CredStore.waterState(); }
    @JavascriptInterface public void clearWater() { CredStore.clearWater(); }

    @JavascriptInterface
    public void cxClear() {
        CxNet.clearCookies();
        CredStore.clearCx();
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
