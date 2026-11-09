package com.jxufe.jct;

import android.content.Context;
import android.webkit.WebView;

import java.io.File;

final class Store {
    private static final long TRIM_AT = 24L * 1024 * 1024;

    private Store() {}

    private static File webviewDir(Context context) {
        return new File(context.getDataDir(), "app_webview");
    }

    static void sweep(Context context) {
        StoreFiles.trimWebViewDir(webviewDir(context), TRIM_AT);
    }

    static void trimWebViewCache(Context context, WebView web) {
        if (StoreFiles.webCacheBytes(webviewDir(context)) >= TRIM_AT) web.clearCache(true);
    }
}
