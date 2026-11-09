package com.jxufe.jct;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONArray;
import org.json.JSONObject;

/** Official JUFE pages only. No JavascriptInterface and no cookie or credential export. */
public final class AcademicActivity extends Activity {
    static final String ENTRY = "https://jwxt.jxufe.edu.cn/jxcjcaslogin";
    private static final String ACADEMIC = "jwxt.jxufe.edu.cn";
    private static final String AUTH = "ssl.jxufe.edu.cn";
    private static final long STRUCTURE_TIMEOUT_MS = 5000;
    private static final String[] LABELS = {
        "课程名称", "课程代码", "任课教师", "星期", "节次", "周次", "校区", "教学楼", "教室", "学期",
        "星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日", "星期天",
        "上课班级代码", "课程", "总学时", "学分", "修读性质", "选课状态", "上课时间地点"
    };
    private static final String STRUCTURE =
        "(function(){if(location.origin!=='https://jwxt.jxufe.edu.cn')return {status:'origin'};try{"
        + "var labels=" + new JSONArray(java.util.Arrays.asList(LABELS)).toString() + ";"
        + "var origin=location.origin, docs=[document], frames=0, sameOriginFrames=0, tables=[];"
        + "for(var i=0;i<docs.length;i++){"
        + "var children=docs[i].querySelectorAll('iframe,frame');"
        + "for(var j=0;j<children.length && frames<50;j++){frames++;"
        + "var child=children[j].contentDocument;"
        + "if(child && child.location.origin===origin && child.readyState!=='loading' && !docs.includes(child)){"
        + "docs.push(child);sameOriginFrames++;}}"
        + "var found=docs[i].querySelectorAll('table,[role=grid],[role=table]');"
        + "for(var k=0;k<found.length && tables.length<50;k++)tables.push(found[k]);}"
        + "var candidates=tables.map(function(t){var rows=t.rows||t.querySelectorAll('[role=row]');"
        + "var head=Array.from(t.querySelectorAll('th,[role=columnheader]')).slice(0,60);"
        + "if(rows[0])head=head.concat(Array.from(rows[0].cells||rows[0].children).slice(0,30));"
        + "return {rows:rows.length,labels:labels.filter(function(l){return head.some(function(h){"
        + "return h.textContent.replace(/^\\s+|\\s+$/g,'')===l;});})};});"
        + "candidates.sort(function(a,b){return b.labels.length-a.labels.length;});"
        + "return {tables:tables.length,frames:frames,sameOriginFrames:sameOriginFrames,"
        + "candidates:candidates.slice(0,8)};}catch(e){return {status:'scan'};}})()";

    private WebView web;
    private TextView diagnosticView;
    private boolean inspecting;
    private int inspectionId;
    private String diagnostic = "";
    private String gridProjection = "";
    private String readerScript;
    private boolean automatic;
    private boolean interactive;
    private boolean navigated;
    private int automaticRun;
    private String requestedTerm;

    static boolean isSchool(Uri uri) {
        return "https".equals(uri.getScheme()) && uri.getUserInfo() == null
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && (ACADEMIC.equals(uri.getHost()) || AUTH.equals(uri.getHost()));
    }

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        automatic = getIntent().getBooleanExtra("automatic", false);
        interactive = getIntent().getBooleanExtra("interactive", false);
        requestedTerm = getIntent().getStringExtra("term");
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        Button close = new Button(this);
        close.setText("返回酱菜通");
        close.setOnClickListener(view -> returnToApp());
        layout.addView(close);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            Button inspect = new Button(this);
            inspect.setText("检查已打开的本人课表结构（Debug）");
            inspect.setOnClickListener(view -> inspectTimetable());
            layout.addView(inspect);
        }
        diagnosticView = new TextView(this);
        diagnosticView.setVisibility(View.GONE);
        layout.addView(diagnosticView);

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSaveFormData(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new SchoolClient());
        layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(layout);
        if (state == null || web.restoreState(state) == null) web.loadUrl(ENTRY);
        if (automatic && !interactive) web.postDelayed(() -> {
            if (!isFinishing() && !isDestroyed()) finishSync(null, "request");
        }, 30000);
    }

    private final class SchoolClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return request.isForMainFrame() && !isSchool(request.getUrl());
        }

        @Override public void onPageFinished(WebView view, String url) {
            if (!automatic || isFinishing()) return;
            Uri page = Uri.parse(url);
            if (ACADEMIC.equals(page.getHost()) && isSchool(page)) {
                navigated = false;
                int run = ++automaticRun;
                autoRead(run, 0);
                if (interactive) web.postDelayed(() -> {
                    if (run == automaticRun && !isFinishing() && !isDestroyed()) stopInteractiveRead();
                }, 25000);
            } else if (AUTH.equals(page.getHost()) && !interactive) {
                finishSync(null, "expired");
            }
        }

        @Override public void onReceivedError(WebView view, WebResourceRequest request,
                                              android.webkit.WebResourceError error) {
            if (automatic && request.isForMainFrame() && !isFinishing()) finishSync(null, "request");
        }
    }

    private String readerExpression(String term, boolean navigate) throws IOException {
        if (readerScript == null) {
            try (InputStream input = getAssets().open("web/jufe-portal-reader.js");
                 ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                for (int count; (count = input.read(buffer)) != -1;) bytes.write(buffer, 0, count);
                readerScript = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
            }
        }
        return readerScript + "(" + JSONObject.quote(term == null ? "" : term) + "," + navigate + ")";
    }

    private void autoRead(int run, int attempt) {
        if (run != automaticRun || isFinishing() || isDestroyed()) return;
        Uri page = Uri.parse(web.getUrl() == null ? "" : web.getUrl());
        if (!isSchool(page) || !ACADEMIC.equals(page.getHost())) return;
        if (attempt >= 24) {
            if (!interactive) finishSync(null, "request");
            else stopInteractiveRead();
            return;
        }
        try {
            web.evaluateJavascript(readerExpression(requestedTerm, !navigated), result -> {
                if (run != automaticRun || isFinishing() || isDestroyed()) return;
                JSONObject response = readObject(result);
                if (response != null && "opened".equals(response.optString("status"))) navigated = true;
                String grid = sanitizeGridProjection(result);
                if (!grid.isEmpty() && response != null) {
                    finishVerified(grid, response);
                } else {
                    web.postDelayed(() -> autoRead(run, attempt + 1), 650);
                }
            });
        } catch (IOException error) {
            finishSync(null, "request");
        }
    }

    private void stopInteractiveRead() {
        automaticRun++;
        showDiagnostic("未自动读到课表，请返回酱菜通后重试。");
    }

    private void finishVerified(String grid, JSONObject response) {
        try {
            String owner = response.getString("owner");
            if (!owner.matches("\\d{5,20}")) throw new IllegalArgumentException();
            JSONArray supplied = response.getJSONArray("terms");
            JSONArray terms = new JSONArray();
            for (int i = 0; i < Math.min(32, supplied.length()); i++) {
                String label = supplied.optString(i);
                if (label.matches("20\\d{2}-20\\d{2}学年第[一二]学期")) terms.put(label);
            }
            String current = response.optString("current");
            if (!current.matches("20\\d{2}-20\\d{2}学年第[一二]学期")) throw new IllegalArgumentException();
            JSONObject capture = new JSONObject().put("accountKey", accountKey(owner))
                    .put("grid", grid).put("terms", terms).put("current", current);
            finishSync(capture.toString(), "");
        } catch (Exception error) {
            finishSync(null, "format");
        }
    }

    private String accountKey(String owner) throws Exception {
        android.content.SharedPreferences preferences = getSharedPreferences("jufe_scope", MODE_PRIVATE);
        String secret = preferences.getString("key", "");
        if (secret.isEmpty()) {
            byte[] random = new byte[32];
            new SecureRandom().nextBytes(random);
            secret = android.util.Base64.encodeToString(random, android.util.Base64.NO_WRAP);
            if (!preferences.edit().putString("key", secret).commit()) throw new IOException();
        }
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(android.util.Base64.decode(secret, android.util.Base64.NO_WRAP), "HmacSHA256"));
        return android.util.Base64.encodeToString(mac.doFinal(owner.getBytes(StandardCharsets.UTF_8)),
                android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP | android.util.Base64.NO_PADDING);
    }

    private static JSONObject readObject(String result) {
        if (result == null || result.length() > 65536) return null;
        try { return new JSONObject(result); }
        catch (org.json.JSONException error) { return null; }
    }

    private void finishSync(String capture, String error) {
        setResult(RESULT_OK, new Intent().putExtra("capture", capture).putExtra("syncError", error));
        finish();
    }

    private void inspectTimetable() {
        if (inspecting) return;
        diagnostic = "";
        gridProjection = "";
        Uri page = Uri.parse(web.getUrl() == null ? "" : web.getUrl());
        if (!isSchool(page) || !ACADEMIC.equals(page.getHost())) {
            showDiagnostic("当前不是教务页面。请完成校方登录，再打开本人课表。");
            return;
        }
        inspecting = true;
        int id = ++inspectionId;
        showDiagnostic("正在确认教务窗口能否执行脚本…");
        Runnable heartbeatTimeout = scheduleTimeout(id, "教务窗口脚本未回调，尚未开始读取课表。");
        web.evaluateJavascript("'jct-ready'", result -> {
            if (!isCurrentInspection(id)) return;
            diagnosticView.removeCallbacks(heartbeatTimeout);
            if (!"\"jct-ready\"".equals(result)) {
                inspecting = false;
                showDiagnostic("教务窗口脚本测试未通过，尚未开始读取课表。");
                return;
            }
            readPortalGrid(id);
        });
    }

    private void readPortalGrid(int id) {
        final String script;
        try {
            script = readerExpression("", false);
        } catch (IOException error) {
            inspecting = false;
            showDiagnostic("课表读取脚本不可用。");
            return;
        }
        showDiagnostic("正在读取当前个人课表…");
        Runnable timeout = scheduleTimeout(id, "读取个人课表超时。当前窗口已保留。");
        web.evaluateJavascript(script, result -> {
            if (!isCurrentInspection(id)) return;
            diagnosticView.removeCallbacks(timeout);
            gridProjection = sanitizeGridProjection(result);
            if (gridProjection.isEmpty()) {
                scanStructure(id);
                return;
            }
            inspecting = false;
            if (automatic) {
                JSONObject verified = readObject(result);
                if (verified != null) finishVerified(gridProjection, verified);
                return;
            }
            try {
                JSONObject grid = new JSONObject(gridProjection);
                diagnostic = new JSONObject().put("term", grid.getString("termLabel"))
                        .put("courseBlocks", grid.getJSONArray("blocks").length()).toString();
            } catch (org.json.JSONException error) {
                diagnostic = "";
                gridProjection = "";
            }
            showDiagnostic(diagnostic.isEmpty() ? "个人课表结构未通过校验。"
                    : "本机脱敏结构 · " + diagnostic + "。返回酱菜通校验解析。");
        });
    }

    private static String sanitizeGridProjection(String result) {
        if (result == null || result.length() > 65536) return "";
        try {
            JSONObject grid = new JSONObject(result);
            String term = grid.getString("termLabel");
            JSONArray blocks = grid.getJSONArray("blocks");
            if (!term.matches("20\\d{2}-20\\d{2}学年第[一二]学期")
                    || blocks.length() == 0 || blocks.length() > 120) return "";
            JSONArray safeBlocks = new JSONArray();
            for (int i = 0; i < blocks.length(); i++) {
                JSONObject block = blocks.getJSONObject(i);
                String weekday = block.getString("weekday");
                String text = block.getString("text");
                if (!weekday.matches("星期[一二三四五六日]") || text.length() > 403) return "";
                safeBlocks.put(new JSONObject().put("weekday", weekday).put("text", text));
            }
            return new JSONObject().put("termLabel", term).put("blocks", safeBlocks).toString();
        } catch (org.json.JSONException error) {
            return "";
        }
    }

    private void scanStructure(int id) {
        showDiagnostic("教务窗口脚本可执行，正在检查课表结构…");
        Runnable scanTimeout = scheduleTimeout(id, "课表结构检查超时。当前窗口已保留。");
        web.evaluateJavascript(STRUCTURE, result -> {
            if (!isCurrentInspection(id)) return;
            diagnosticView.removeCallbacks(scanTimeout);
            inspecting = false;
            diagnostic = sanitizeStructure(result);
            String message = "未读取到课表结构。请等页面加载完成后重试。";
            if ("{\"status\":\"origin\"}".equals(result)) message = "当前文档与教务入口不同源。";
            if ("{\"status\":\"scan\"}".equals(result)) message = "当前教务文档的结构检查遇到异常。";
            showDiagnostic(diagnostic.isEmpty() ? message : "本机脱敏结构 · " + diagnostic);
        });
    }

    private boolean isCurrentInspection(int id) {
        return inspecting && inspectionId == id && !isFinishing() && !isDestroyed();
    }

    private Runnable scheduleTimeout(int id, String message) {
        Runnable timeout = () -> {
            if (!isCurrentInspection(id)) return;
            inspecting = false;
            showDiagnostic(message);
        };
        diagnosticView.postDelayed(timeout, STRUCTURE_TIMEOUT_MS);
        return timeout;
    }

    private void showDiagnostic(String message) {
        diagnosticView.setText(message);
        diagnosticView.setVisibility(View.VISIBLE);
    }

    private static String sanitizeStructure(String result) {
        if (result == null || result.length() > 4096) return "";
        try {
            JSONObject input = new JSONObject(result);
            if (input.has("status") || !input.has("tables") || !input.has("frames")) return "";
            JSONObject safe = new JSONObject();
            safe.put("tables", Math.max(0, Math.min(50, input.optInt("tables"))));
            int frames = Math.max(0, Math.min(50, input.optInt("frames")));
            safe.put("frames", frames);
            safe.put("sameOriginFrames", Math.max(0, Math.min(frames, input.optInt("sameOriginFrames"))));
            JSONArray candidates = input.optJSONArray("candidates");
            JSONArray tables = new JSONArray();
            for (int i = 0; candidates != null && i < Math.min(8, candidates.length()); i++) {
                JSONObject row = candidates.optJSONObject(i);
                if (row == null) continue;
                JSONArray supplied = row.optJSONArray("labels");
                JSONArray recognized = new JSONArray();
                for (String label : LABELS) {
                    for (int j = 0; supplied != null && j < supplied.length(); j++) {
                        if (label.equals(supplied.optString(j))) { recognized.put(label); break; }
                    }
                }
                JSONObject table = new JSONObject();
                table.put("rows", Math.max(0, Math.min(10000, row.optInt("rows"))));
                table.put("labels", recognized);
                tables.put(table);
            }
            safe.put("candidates", tables);
            return safe.toString();
        } catch (org.json.JSONException error) {
            return "";
        }
    }

    private void returnToApp() {
        setResult(RESULT_OK, new Intent().putExtra("structure", diagnostic).putExtra("gridProjection", gridProjection));
        finish();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        web.saveState(state);
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else returnToApp();
    }

    @Override protected void onDestroy() {
        setContentView(new View(this));
        web.destroy();
        super.onDestroy();
    }
}
