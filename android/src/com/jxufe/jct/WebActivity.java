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
    private Button done;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        done = new Button(this);
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
        if (state == null || web.restoreState(state) == null) {
            done.setEnabled(false);
            resetBrowserCookies(() -> {
                done.setEnabled(true);
                web.loadUrl(LOGIN);
            });
        }
    }

    private static final class StudyClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return request.isForMainFrame() && !NativeBridge.isChaoxing(request.getUrl());
        }
    }

    private void resetBrowserCookies(Runnable complete) {
        CookieManager cookies = CookieManager.getInstance();
        cookies.removeAllCookies(removed -> {
            cookies.flush();
            if (!isFinishing() && !isDestroyed()) complete.run();
        });
    }

    private void useSession() {
        Uri page = Uri.parse(web.getUrl() == null ? "" : web.getUrl());
        try {
            if (!NativeBridge.isChaoxing(page) || !CxNet.isHost(page.getHost())
                    || "passport2.chaoxing.com".equals(page.getHost())
                    || !CxNet.importWebSession(CookieManager.getInstance())) {
                Toast.makeText(this, "请完成官方页面登录并进入学习通后再返回", Toast.LENGTH_LONG).show();
                return;
            }
        } catch (IllegalStateException error) {
            Toast.makeText(this, error.getMessage(), Toast.LENGTH_LONG).show();
            return;
        }
        done.setEnabled(false);
        web.stopLoading();
        resetBrowserCookies(this::finish);
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
