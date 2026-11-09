package com.jxufe.jct;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.CookieStore;
import java.net.HttpCookie;
import java.net.URI;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

final class CxNet {
    private static final String API_HOST = "mooc1-api.chaoxing.com";
    private static final String[] HOSTS = {
        "passport2.chaoxing.com", "chaoxing.com", "i.chaoxing.com", "mooc1.chaoxing.com",
        API_HOST, "mooc2-ans.chaoxing.com", "mobilelearn.chaoxing.com"
    };
    private static volatile CookieManager jar = newJar();

    private CxNet() {}

    static boolean isHost(String host) {
        return Arrays.asList(HOSTS).contains(host);
    }

    private static CookieManager newJar() {
        return new CookieManager(null, (uri, cookie) -> isHost(uri.getHost())
                && isHost(cookieHost(cookie))
                && CookiePolicy.ACCEPT_ORIGINAL_SERVER.shouldAccept(uri, cookie));
    }

    private static String cookieHost(HttpCookie cookie) {
        String domain = cookie.getDomain();
        return domain != null && domain.startsWith(".") ? domain.substring(1) : domain;
    }

    static CookieManager cookieJar() {
        return jar;
    }

    static synchronized void clearSession() {
        CredStore.clearCx();
        // A running HTTP request can update its old jar without restoring the cleared session.
        jar = newJar();
    }

    static synchronized boolean importWebSession(android.webkit.CookieManager webCookies) {
        CookieManager candidate = newJar();
        for (String host : HOSTS) {
            URI site = URI.create("https://" + host + "/");
            String header = webCookies.getCookie(site.toString());
            if (header == null) continue;
            for (String entry : header.split(";")) {
                int equals = entry.indexOf('=');
                if (equals < 1) continue;
                String name = entry.substring(0, equals).trim();
                String value = entry.substring(equals + 1).trim();
                if (value.isEmpty()) continue;
                try {
                    HttpCookie cookie = new HttpCookie(name, value);
                    cookie.setVersion(0);
                    cookie.setDomain(host);
                    cookie.setPath("/");
                    cookie.setSecure(true);
                    candidate.getCookieStore().add(site, cookie);
                } catch (IllegalArgumentException ignored) {
                    // Ignore malformed pairs returned by WebView.
                }
            }
        }
        if (!hasIdentity(candidate)) return false;
        String failure = CredStore.saveCx(dumpCookies(candidate));
        if (!failure.isEmpty()) throw new IllegalStateException(failure);
        jar = candidate;
        return true;
    }

    private static boolean hasIdentity(CookieManager candidate) {
        Map<String, String> identities = new HashMap<>();
        boolean hasApiIdentity = false;
        for (HttpCookie cookie : candidate.getCookieStore().getCookies()) {
            String name = cookie.getName();
            String value = cookie.getValue();
            if (!("UID".equals(name) || "_uid".equals(name)) || value == null || value.isEmpty()) continue;
            if (API_HOST.equals(cookieHost(cookie)) || ".chaoxing.com".equals(cookie.getDomain())) {
                hasApiIdentity = true;
            }
            String previous = identities.putIfAbsent(name, value);
            if (previous != null && !previous.equals(value)) return false;
        }
        return hasApiIdentity;
    }

    static boolean hasLogin() {
        return hasIdentity(jar);
    }

    static synchronized String persist() {
        return hasIdentity(jar) ? CredStore.saveCx(dumpCookies(jar)) : "学习通会话不可用";
    }

    private static String dumpCookies(CookieManager source) {
        JSONArray entries = new JSONArray();
        for (HttpCookie cookie : source.getCookieStore().getCookies()) {
            if (!isHost(cookieHost(cookie)) || cookie.hasExpired()) continue;
            JSONObject entry = new JSONObject();
            try {
                entry.put("name", cookie.getName());
                entry.put("value", cookie.getValue());
                entry.put("domain", cookie.getDomain());
                entry.put("path", cookie.getPath());
                entry.put("version", cookie.getVersion());
                entries.put(entry);
            } catch (org.json.JSONException ignored) { }
        }
        return entries.toString();
    }

    static void restore() {
        String stored = CredStore.loadCx();
        if (stored.isEmpty()) return;
        CookieManager candidate = newJar();
        CookieStore cookies = candidate.getCookieStore();
        try {
            JSONArray entries = new JSONArray(stored);
            for (int i = 0; i < entries.length(); i++) {
                JSONObject entry = entries.optJSONObject(i);
                if (entry == null) continue;
                try {
                    HttpCookie cookie = new HttpCookie(entry.optString("name"), entry.optString("value"));
                    cookie.setDomain(entry.optString("domain"));
                    String host = cookieHost(cookie);
                    if (!isHost(host) || cookie.getValue().isEmpty()) continue;
                    cookie.setPath(entry.optString("path", "/"));
                    cookie.setVersion(entry.optInt("version", 0));
                    cookie.setSecure(true);
                    cookies.add(URI.create("https://" + host + "/"), cookie);
                } catch (IllegalArgumentException ignored) { }
            }
        } catch (org.json.JSONException ignored) {
            return;
        }
        if (hasIdentity(candidate)) jar = candidate;
    }
}
