package com.jxufe.jct;

import android.net.Uri;
import android.util.Log;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.CookieHandler;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/** The HTTPS branch of hangyuantong NativeBridge.doReq (Hobson2233, MIT). */
final class WaterHttp {
    private static final String HOST = "i.ilife798.com";
    private static final String API = "/api/v1";
    private static final String UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
    private static final CookieManager COOKIES = new CookieManager(null, CookiePolicy.ACCEPT_ALL);

    private WaterHttp() { }

    // Keep the upstream automatic HttpURLConnection cookie handling scoped to 798.
    static synchronized void installCookies() {
        CookieHandler previous = CookieHandler.getDefault();
        if (previous instanceof WaterCookies) return;
        CookieHandler.setDefault(new WaterCookies(previous));
    }

    private static final class WaterCookies extends CookieHandler {
        private final CookieHandler previous;

        WaterCookies(CookieHandler previous) {
            this.previous = previous;
        }

        @Override
        public Map<String, List<String>> get(URI uri, Map<String, List<String>> headers) throws IOException {
            if (isService(Uri.parse(uri.toString()))) return COOKIES.get(uri, headers);
            return previous == null ? Collections.emptyMap() : previous.get(uri, headers);
        }

        @Override
        public void put(URI uri, Map<String, List<String>> headers) throws IOException {
            if (isService(Uri.parse(uri.toString()))) COOKIES.put(uri, headers);
            else if (previous != null) previous.put(uri, headers);
        }
    }

    static void clearCookies() {
        COOKIES.getCookieStore().removeAll();
    }

    static boolean isCaptcha(Uri uri) {
        return isService(uri) && (API + "/captcha/").equals(uri.getPath());
    }

    private static boolean isService(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
                && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private static boolean allowed(String method, Uri uri) {
        if (!isService(uri)) return false;
        String path = uri.getPath();
        if ("POST".equals(method)) {
            return (API + "/acc/login/code").equals(path) || (API + "/acc/login").equals(path);
        }
        if (!"GET".equals(method) || path == null || !path.startsWith(API + "/")) return false;
        switch (path.substring(API.length())) {
            case "/acc/wallet/owner":
            case "/acc/view-info":
            case "/ui/app/master":
            case "/bill/lst-owner":
                return true;
            case "/bill/view-full":
                String id = uri.getQueryParameter("id");
                return id != null && id.matches("[A-Za-z0-9_-]{1,128}")
                        && uri.getQueryParameterNames().equals(Collections.singleton("id"))
                        && uri.getQueryParameters("id").size() == 1;
            case "/dev/start":
            case "/dev/end":
                String device = uri.getQueryParameter("did");
                return device != null && !device.isEmpty();
            default:
                return false;
        }
    }

    static JSONObject request(String method, URL url, String body, String headers,
                              boolean debug) throws Exception {
        if (!allowed(method, Uri.parse(url.toString()))) throw new SecurityException("Unsupported water request");
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        try {
            c.setRequestMethod(method);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("User-Agent", UA);
            c.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9");
            c.setRequestProperty("Accept",
                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
            boolean hasCt = applyHeaders(c, headers);
            if (body != null && !body.isEmpty()) {
                c.setDoOutput(true);
                if (!hasCt) c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                byte[] raw = body.getBytes(StandardCharsets.UTF_8);
                c.setFixedLengthStreamingMode(raw.length);
                try (OutputStream os = c.getOutputStream()) {
                    os.write(raw);
                }
            }

            int code = c.getResponseCode();
            String text = readAll(code >= 400 ? c.getErrorStream() : c.getInputStream());
            URL finalUrl = c.getURL();
            String location = c.getHeaderField("Location");
            // Upstream's fallback is a GET. Restrict it to read-only 798 routes.
            if (code >= 300 && code < 400 && location != null && !location.isEmpty()
                    && !url.getPath().startsWith(API + "/dev/")) {
                URL next = new URL(finalUrl, location);
                if (allowed("GET", Uri.parse(next.toString())) && !next.getPath().startsWith(API + "/dev/")) {
                    HttpURLConnection c2 = (HttpURLConnection) next.openConnection();
                    try {
                        c2.setConnectTimeout(15000);
                        c2.setReadTimeout(30000);
                        c2.setInstanceFollowRedirects(false);
                        c2.setRequestProperty("User-Agent", UA);
                        c2.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9");
                        code = c2.getResponseCode();
                        text = readAll(code >= 400 ? c2.getErrorStream() : c2.getInputStream());
                        finalUrl = c2.getURL();
                    } finally {
                        c2.disconnect();
                    }
                }
            }

            if (debug && "POST".equals(method)) {
                String phase = (API + "/acc/login/code").equals(url.getPath()) ? "sms" : "login";
                int business = Integer.MIN_VALUE;
                try { business = new JSONObject(text).optInt("code", Integer.MIN_VALUE); }
                catch (org.json.JSONException ignored) { }
                Log.d("JCTWater", phase + " http=" + code + " code="
                        + (business == Integer.MIN_VALUE ? "none" : String.valueOf(business))
                        + " setCookie=" + (c.getHeaderField("Set-Cookie") != null
                                           || c.getHeaderField("Set-Cookie2") != null));
            }

            JSONObject result = new JSONObject();
            result.put("status", code);
            result.put("body", text);
            result.put("url", finalUrl.toString());
            result.put("date", c.getDate());
            return result;
        } finally {
            c.disconnect();
        }
    }

    private static boolean applyHeaders(HttpURLConnection c, String headersJson) {
        boolean hasCt = false;
        if (headersJson == null || headersJson.isEmpty()) return false;
        try {
            JSONObject o = new JSONObject(headersJson);
            Iterator<String> it = o.keys();
            while (it.hasNext()) {
                String k = it.next();
                if (k.isEmpty() || "content-length".equalsIgnoreCase(k)) continue;
                if ("content-type".equalsIgnoreCase(k)) hasCt = true;
                c.setRequestProperty(k, o.optString(k, ""));
            }
        } catch (org.json.JSONException ignored) {
            // As in upstream, a missing header object does not block the request.
        }
        return hasCt;
    }

    private static String readAll(InputStream stream) throws IOException {
        if (stream == null) return "";
        try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = in.read(buffer)) > 0) out.write(buffer, 0, count);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
