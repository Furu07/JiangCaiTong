package com.jxufe.jct;


import org.json.JSONArray;
import org.json.JSONObject;

import java.net.CookieHandler;
import java.net.CookieManager;
import java.net.CookieStore;
import java.net.HttpCookie;
import java.net.URI;
import java.util.List;


final class CxNet {
    private static final String[] HOSTS = {
        "passport2.chaoxing.com", "chaoxing.com", "i.chaoxing.com", "mooc1.chaoxing.com",
        "mooc1-api.chaoxing.com", "mooc2-ans.chaoxing.com", "mobilelearn.chaoxing.com"
    };

    private CxNet() {}

    static void clearCookies() {
        CookieStore cookies = store();
        if (cookies != null) cookies.removeAll();
    }

    static boolean importWebSession(android.webkit.CookieManager webCookies) {
        java.util.Map<URI, List<HttpCookie>> session = new java.util.LinkedHashMap<>();
        boolean hasUid = false;
        for (String host : HOSTS) {
            URI site = URI.create("https://" + host + "/");
            String header = webCookies.getCookie(site.toString());
            if (header == null) continue;
            List<HttpCookie> cookies = new java.util.ArrayList<>();
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
                    cookies.add(cookie);
                    if (name.equals("UID") || name.equals("_uid")) hasUid = true;
                } catch (IllegalArgumentException ignored) {
                    // Ignore malformed cookie pairs returned by WebView.
                }
            }
            session.put(site, cookies);
        }
        CookieStore target = store();
        if (!hasUid || target == null) return false;
        target.removeAll();
        session.forEach((site, cookies) -> cookies.forEach(cookie -> target.add(site, cookie)));
        return true;
    }

    /**
     * 把罐子里**所有** cookie 导成 JSON。
     *
     * 每条带 domain：`.chaoxing.com` 这种跨子域的必须原样保留 ——
     * 丢了 Domain 就退化成「仅此域名」，换个二级域就看不见了，
     * 表现是「明明登录过，进去又说没登录」。
     */
    public static String dumpCookies() {
        JSONArray arr = new JSONArray();
        try {
            CookieStore store = store();
            if (store == null) return arr.toString();
            List<HttpCookie> all = store.getCookies();
            if (all == null) return arr.toString();
            for (HttpCookie ck : all) {
                if (ck == null) continue;
                String domain = ck.getDomain();
                if (domain == null) continue;
                String host = domain.startsWith(".") ? domain.substring(1) : domain;
                if (!NativeBridge.isChaoxing(android.net.Uri.parse("https://" + host + "/"))) continue;
                String name = ck.getName();
                String val = ck.getValue();
                if (name == null || name.isEmpty() || val == null) continue;
                // Max-Age = 0 是「删掉这条」的指令，不是一条 cookie
                if (ck.getMaxAge() == 0) continue;
                JSONObject o = new JSONObject();
                o.put("name", name);
                o.put("value", val);
                o.put("domain", ck.getDomain() == null ? "" : ck.getDomain());
                o.put("path", ck.getPath() == null ? "/" : ck.getPath());
                o.put("secure", ck.getSecure());
                o.put("version", ck.getVersion());
                arr.put(o);
            }
        } catch (Throwable ignored) {
            // 导出失败就当没存过 —— 用户下次重登一次，不影响别的功能
        }
        return arr.toString();
    }

    /**
     * 把 JSON 还原进罐子。
     *
     * @return 还原成功的条数（调用方用它判断「到底有没有登录态」）。
     *
     * 🔴 单条坏了必须 continue，不能让一条异常带走整批 ——
     *    否则一条残缺 cookie 就等于「全部没还原」，看起来又像登录失效。
     */
    public static int loadCookies(String json) {
        if (json == null || json.isEmpty()) return 0;
        int n = 0;
        try {
            CookieStore store = store();
            if (store == null) return 0;
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String name = o.optString("name", "");
                String val = o.optString("value", "");
                if (name.isEmpty() || val.isEmpty()) continue;
                try {
                    HttpCookie ck = new HttpCookie(name, val);
                    String dom = o.optString("domain", "");
                    if (!dom.isEmpty()) ck.setDomain(dom);
                    String p = o.optString("path", "/");
                    ck.setPath(p.isEmpty() ? "/" : p);
                    ck.setSecure(o.optBoolean("secure", false));

                    // 还原时给一个「属于这个 domain」的地址。
                    // 带 Domain 属性的 cookie 拿不匹配的 host 去 add，会被直接丢掉。
                    String host = dom;
                    while (host.startsWith(".")) host = host.substring(1);
                    if (!NativeBridge.isChaoxing(android.net.Uri.parse("https://" + host + "/"))) continue;
                    ck.setVersion(o.optInt("version", 0));
                    store.add(new URI("https://" + host + "/"), ck);
                    n++;
                } catch (Throwable ignored) {
                    // 这一条坏了，接着下一条
                }
            }
        } catch (Throwable ignored) {
            // 整段 JSON 坏了：返回已经还原的条数
        }
        return n;
    }

    /** 罐子里有没有登录态。看 UID —— 那是 `.chaoxing.com` 域上跨站有效的那份。 */
    public static boolean hasLogin() {
        try {
            CookieStore store = store();
            if (store == null) return false;
            List<HttpCookie> all = store.getCookies();
            if (all == null) return false;
            for (HttpCookie ck : all) {
                if (ck == null) continue;
                if (!"UID".equals(ck.getName()) && !"_uid".equals(ck.getName())) continue;
                String v = ck.getValue();
                if (v != null && !v.isEmpty()) return true;
            }
        } catch (Throwable ignored) {
            // 罐子摸不到 = 当作没登录
        }
        return false;
    }

    private static CookieStore store() {
        CookieHandler h = CookieHandler.getDefault();
        if (!(h instanceof CookieManager)) return null;
        return ((CookieManager) h).getCookieStore();
    }
}
