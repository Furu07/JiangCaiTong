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
import org.json.JSONArray;
import org.json.JSONObject;

/** Official JUFE pages only. No JavascriptInterface and no cookie or credential export. */
public final class AcademicActivity extends Activity {
    static final String ENTRY = "https://jwxt.jxufe.edu.cn/jxcjcaslogin";
    private static final String ACADEMIC = "jwxt.jxufe.edu.cn";
    private static final String AUTH = "ssl.jxufe.edu.cn";
    private static final String[] LABELS = {
        "课程名称", "课程代码", "任课教师", "星期", "节次", "周次", "校区", "教学楼", "教室", "学期",
        "星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日", "星期天"
    };
    private static final String STRUCTURE =
        "(function(){if(location.origin!=='https://jwxt.jxufe.edu.cn')return {status:'origin'};try{"
        + "var labels=" + new JSONArray(java.util.Arrays.asList(LABELS)).toString() + ";"
        + "var origin=location.origin, docs=[document], frames=0, sameOriginFrames=0, tables=[];"
        + "for(var i=0;i<docs.length;i++){"
        + "var children=docs[i].querySelectorAll('iframe,frame');"
        + "for(var j=0;j<children.length && frames<50;j++){frames++;"
        + "try{var child=children[j].contentWindow;"
        + "if(child && child.location.origin===origin && child.document.readyState!=='loading'){"
        + "docs.push(child.document);sameOriginFrames++;}}catch(e){if(e.name!=='SecurityError')throw e;}}"
        + "var found=docs[i].querySelectorAll('table');"
        + "for(var k=0;k<found.length && tables.length<50;k++)tables.push(found[k]);}"
        + "var candidates=tables.map(function(t){var head=Array.from(t.querySelectorAll('th')).slice(0,60);"
        + "if(t.rows[0])head=head.concat(Array.from(t.rows[0].cells).slice(0,30));"
        + "return {rows:t.rows.length,labels:labels.filter(function(l){return head.some(function(h){"
        + "return h.textContent.trim()===l;});})};});"
        + "candidates.sort(function(a,b){return b.labels.length-a.labels.length;});"
        + "return {tables:tables.length,frames:frames,sameOriginFrames:sameOriginFrames,"
        + "candidates:candidates.slice(0,8)};}catch(e){return {status:'scan'};}})()";

    private WebView web;
    private TextView diagnosticView;
    private String diagnostic = "";

    static boolean isSchool(Uri uri) {
        return "https".equals(uri.getScheme()) && uri.getUserInfo() == null
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && (ACADEMIC.equals(uri.getHost()) || AUTH.equals(uri.getHost()));
    }

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle state) {
        super.onCreate(state);
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
            diagnosticView = new TextView(this);
            diagnosticView.setVisibility(View.GONE);
            layout.addView(diagnosticView);
        }

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
    }

    private static final class SchoolClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return request.isForMainFrame() && !isSchool(request.getUrl());
        }
    }

    private void inspectTimetable() {
        diagnostic = "";
        Uri page = Uri.parse(web.getUrl() == null ? "" : web.getUrl());
        if (!isSchool(page) || !ACADEMIC.equals(page.getHost())) {
            showDiagnostic("当前不是教务页面。请完成校方登录，再打开本人课表。");
            return;
        }
        showDiagnostic("正在检查课表结构…");
        web.evaluateJavascript(STRUCTURE, result -> {
            if (isFinishing() || isDestroyed()) return;
            diagnostic = sanitizeStructure(result);
            String message = "未读取到课表结构。请等页面加载完成后重试。";
            if ("{\"status\":\"origin\"}".equals(result)) message = "当前文档与教务入口不同源。";
            if ("{\"status\":\"scan\"}".equals(result)) message = "当前教务文档的结构检查遇到异常。";
            showDiagnostic(diagnostic.isEmpty() ? message : "本机脱敏结构 · " + diagnostic);
        });
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
        setResult(RESULT_OK, new Intent().putExtra("structure", diagnostic));
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
