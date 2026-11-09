package com.jxufe.jct;

import android.annotation.SuppressLint;
import android.app.Activity;
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
import android.widget.Toast;

/** Official learning-platform login in a WebView isolated from the app bridge. */
public class WebActivity extends Activity {
    private static final String LOGIN = "https://passport2.chaoxing.com/login?fid=&refer="
            + "https%3A%2F%2Fmooc2-ans.chaoxing.com%2Fmooc2-ans%2Fvisit%2Finteraction";
    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        Button done = new Button(this);
        done.setText("完成登录并返回");
        done.setOnClickListener(view -> useSession());
        layout.addView(done);

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSaveFormData(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebViewClient(new StudyClient());
        layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(layout);
        if (state == null || web.restoreState(state) == null) web.loadUrl(LOGIN);
    }

    private static final class StudyClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return request.isForMainFrame() && !NativeBridge.isChaoxing(request.getUrl());
        }
    }

    private void useSession() {
        if (web.getUrl() == null || !NativeBridge.isChaoxing(Uri.parse(web.getUrl()))
                || !CxNet.importWebSession(CookieManager.getInstance())) {
            Toast.makeText(this, "尚未取得学习通登录状态，请完成页面登录", Toast.LENGTH_LONG).show();
            return;
        }
        CookieManager.getInstance().flush();
        if (!CredStore.saveCx(CxNet.dumpCookies()).isEmpty()) {
            Toast.makeText(this, "登录状态已载入，暂时无法保存到本机", Toast.LENGTH_LONG).show();
        }
        finish();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        setContentView(new View(this));
        web.destroy();
        super.onDestroy();
    }
}
