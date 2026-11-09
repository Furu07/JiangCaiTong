package com.jxufe.jct;

import android.app.Application;
import android.content.Context;

/** 只为给 CredStore 一个稳定的 Context —— 存凭据的代码不该依赖 Activity 生命周期。 */
public class App extends Application {

    private static Context ctx;

    @Override
    public void onCreate() {
        super.onCreate();
        ctx = getApplicationContext();
        java.net.CookieHandler.setDefault(new java.net.CookieManager(
                null, (uri, cookie) -> NativeBridge.isChaoxing(android.net.Uri.parse(uri.toString()))
                        && java.net.CookiePolicy.ACCEPT_ORIGINAL_SERVER.shouldAccept(uri, cookie)));
        CxNet.loadCookies(CredStore.loadCx());
    }

    public static Context ctx() {
        return ctx;
    }
}
